// Initialize CodeMirror editor
const editor = CodeMirror.fromTextArea(document.getElementById('gcode-editor'), {
  lineNumbers: true,
  mode: 'gcode',
  theme: 'default'
});

// Reset simulator when code changes
editor.on('change', () => {
  initializeSimulator();
});

function clearHighlightedLines() {
  const totalLines = editor.lineCount();
  for (let i = 0; i < totalLines; i++) {
    editor.removeLineClass(i, 'background', 'highlighted-line');
  }
}

// Initialize canvas and simulator variables
const canvas = document.getElementById('simulation-canvas');
const canvasContainer = document.getElementById('canvas-container');
let simulator;

// Initialize Panzoom for canvas
const panzoom = Panzoom(canvas, {
  maxScale: 5,
  minScale: 0.1,
  contain: 'outside'
});
canvas.parentElement.addEventListener('wheel', panzoom.zoomWithWheel);

// Event listeners for controls
document.getElementById('step-btn').addEventListener('click', () => {
  if (!simulator) initializeSimulator();
  simulator.step();
});

document.getElementById('run-btn').addEventListener('click', () => {
  if (!simulator) initializeSimulator();
  simulator.run();
});

document.getElementById('pause-btn').addEventListener('click', () => {
  if (simulator) simulator.pause();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  if (simulator) simulator.reset();
});

// Reset simulator when scale changes
document.getElementById('scale-input').addEventListener('change', () => {
  initializeSimulator();
});

document.getElementById('speed-input').addEventListener('change', () => {
  if (simulator) {
    const newSpeed = parseInt(document.getElementById('speed-input').value, 10);
    simulator.updateSpeed(newSpeed);
  }
});

function resizeCanvas() {
  const canvas = document.getElementById('simulation-canvas');
  const container = document.getElementById('canvas-container');

  // 获取容器宽高
  const width = container.clientWidth;
  const height = container.clientHeight;

  // 设置画布的显示尺寸
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  // 设置画布的实际尺寸（保证绘图比例）
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;

  // 更新绘制比例
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  initializeSimulator();
}

// 页面加载和窗口大小改变时触发 resizeCanvas
window.addEventListener('load', resizeCanvas);
window.addEventListener('resize', resizeCanvas);


function initializeSimulator() {
  const code = editor.getValue();
  const commands = parseGCode(code);
  const speed = parseInt(document.getElementById('speed-input').value, 10);
  const scale = parseFloat(document.getElementById('scale-input').value);

  if (simulator) {
    simulator.pause();
    simulator.reset();
  }
  simulator = new Simulator(canvas, commands, speed, scale);
  simulator.reset();
}

function parseGCode(code) {
  const lines = code.split('\n');
  const commands = [];

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    let line = lines[lineNumber].trim();
    if (line === '' || line.startsWith(';')) continue; // Skip empty lines and comments
    const parts = line.split(/\s+/);
    const command = {
      raw: line,
      gCode: parts[0],
      params: {},
      lineNumber: lineNumber // Store the original line number
    };
    for (let part of parts.slice(1)) {
      const key = part.charAt(0).toUpperCase();
      const value = parseFloat(part.slice(1));
      command.params[key] = value;
    }
    commands.push(command);
  }
  return commands;
}

class Simulator {
  constructor(canvas, commands, speed = 1, scale = 1) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.commands = commands;
    this.currentPosition = { x: 0, y: 0 };
    this.absoluteMode = true;
    this.origin = { x: 0, y: 0 };
    this.commandIndex = 0;
    this.isRunning = false;
    this.speed = speed;
    this.scale = scale;
    this.previousLine = null;
    this.initializeCanvas();
  }

  initializeCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Adjust coordinate system to match typical G-Code coordinate system
    this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    this.ctx.scale(1, -1); // Invert Y-axis
    this.ctx.lineWidth = this.scale;
  }

  updateSpeed(newSpeed) {
    this.speed = newSpeed;
  }

  reset() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.initializeCanvas();
    this.currentPosition = { x: 0, y: 0 };
    this.absoluteMode = true;
    this.origin = { x: 0, y: 0 };
    this.commandIndex = 0;
    this.isRunning = false;
    clearHighlightedLines();
    this.ctx.lineWidth = 1.5 * this.scale;
  }

  step() {
    if (this.commandIndex >= this.commands.length) {
      this.isRunning = false;
      return;
    }
    const command = this.commands[this.commandIndex];
    this.executeCommand(command);
    this.highlightLine(command);
    this.commandIndex += 1;
  }

  run() {
    this.isRunning = true;
    const runStep = () => {
      if (!this.isRunning) return;
      this.step();
      if (this.commandIndex < this.commands.length) {
        setTimeout(runStep, 1000 / this.speed);
      } else {
        this.isRunning = false;
      }
    };
    runStep();
  }

  pause() {
    this.isRunning = false;
  }

  executeCommand(command) {
    const { gCode, params } = command;
    const code = gCode.toUpperCase();
    if (code === 'G90') {
      this.absoluteMode = true;
    } else if (code === 'G91') {
      this.absoluteMode = false;
    } else if (code === 'G92') {
      this.origin = { ...this.currentPosition };
    } else if (code === 'G01') {
      this.drawLine(params);
    } else if (code === 'G02' || code === 'G03') {
      this.drawArc(params, code === 'G02');
    } else if (code === 'M02') {
      this.isRunning = false; // End of program
    }
  }

  drawLine(params) {
    const xParam = params['X'] !== undefined ? params['X'] * this.scale : this.currentPosition.x;
    const yParam = params['Y'] !== undefined ? params['Y'] * this.scale : this.currentPosition.y;
    let newX, newY;

    if (this.absoluteMode) {
      newX = xParam - this.origin.x;
      newY = yParam - this.origin.y;
    } else {
      newX = this.currentPosition.x + xParam;
      newY = this.currentPosition.y + yParam;
    }

    this.ctx.beginPath();
    this.ctx.moveTo(this.currentPosition.x, this.currentPosition.y);
    this.ctx.lineTo(newX, newY);
    this.ctx.stroke();

    this.currentPosition = { x: newX, y: newY };
  }

  drawArc(params, clockwise) {
    const xParam = params['X'] !== undefined ? params['X'] * this.scale : this.currentPosition.x;
    const yParam = params['Y'] !== undefined ? params['Y'] * this.scale : this.currentPosition.y;
    const i = params['I'] !== undefined ? params['I'] * this.scale : 0;
    const j = params['J'] !== undefined ? params['J'] * this.scale : 0;
    let newX, newY;

    if (this.absoluteMode) {
      newX = xParam - this.origin.x;
      newY = yParam - this.origin.y;
    } else {
      newX = this.currentPosition.x + xParam;
      newY = this.currentPosition.y + yParam;
    }

    const centerX = this.currentPosition.x + i;
    const centerY = this.currentPosition.y + j;

    const radius = Math.hypot(i, j);

    const startAngle = Math.atan2(this.currentPosition.y - centerY, this.currentPosition.x - centerX);
    const endAngle = Math.atan2(newY - centerY, newX - centerX);

    this.ctx.beginPath();
    this.ctx.arc(
      centerX,
      centerY,
      radius,
      startAngle,
      endAngle,
      clockwise
    );
    this.ctx.stroke();

    this.currentPosition = { x: newX, y: newY };
  }

  highlightLine(command) {
    if (this.previousLine !== null) {
      editor.removeLineClass(this.previousLine, 'background', 'highlighted-line');
    }
    editor.addLineClass(command.lineNumber, 'background', 'highlighted-line');
    this.previousLine = command.lineNumber;
  }
}
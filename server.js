const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// สุ่มสร้างการ์ดตามประเภท
function generateBoard(config) {
  const { mode, customWords, freeText, gridDim } = config;

  if (mode === '1-75') {
    const cols = [
      Array.from({ length: 15 }, (_, i) => String(i + 1)),
      Array.from({ length: 15 }, (_, i) => String(i + 16)),
      Array.from({ length: 15 }, (_, i) => String(i + 31)),
      Array.from({ length: 15 }, (_, i) => String(i + 46)),
      Array.from({ length: 15 }, (_, i) => String(i + 61))
    ];
    const grid = [];
    for (let r = 0; r < 5; r++) {
      grid[r] = [];
      for (let c = 0; c < 5; c++) {
        if (r === 2 && c === 2 && config.includeFree) {
          grid[r][c] = { val: freeText || 'FREE', marked: true, isFree: true };
        } else {
          const pool = cols[c];
          const randIdx = Math.floor(Math.random() * pool.length);
          grid[r][c] = { val: pool.splice(randIdx, 1)[0], marked: false, isFree: false };
        }
      }
    }
    return { grid, rows: 5, cols: 5 };
  }

  if (mode === '1-90') {
    // Housie 3x9 Ticket (แต่ละแถวมี 5 ตัวเลข 4 ช่องว่าง)
    const grid = Array.from({ length: 3 }, () => Array(9).fill(null).map(() => ({ val: '', marked: false, isBlank: true })));
    const colRanges = [
      [1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
      [50, 59], [60, 69], [70, 79], [80, 90]
    ];

    for (let r = 0; r < 3; r++) {
      const colIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => 0.5 - Math.random()).slice(0, 5);
      colIndices.forEach(c => {
        const [min, max] = colRanges[c];
        const num = Math.floor(Math.random() * (max - min + 1)) + min;
        grid[r][c] = { val: String(num), marked: false, isBlank: false };
      });
    }
    return { grid, rows: 3, cols: 9 };
  }

  // Custom Bingo
  const size = parseInt(gridDim) || 5;
  const needed = size * size;
  let pool = [...customWords];
  while (pool.length < needed) {
    pool.push(`Item ${pool.length + 1}`);
  }
  const shuffled = pool.sort(() => 0.5 - Math.random());
  const grid = [];
  let idx = 0;
  for (let r = 0; r < size; r++) {
    grid[r] = [];
    for (let c = 0; c < size; c++) {
      const isCenter = size % 2 === 1 && r === Math.floor(size / 2) && c === Math.floor(size / 2);
      if (isCenter && config.includeFree) {
        grid[r][c] = { val: freeText || 'FREE', marked: true, isFree: true };
      } else {
        grid[r][c] = { val: shuffled[idx++], marked: false, isFree: false };
      }
    }
  }
  return { grid, rows: size, cols: size };
}

// ตรวจสอบจำนวนช่องที่ขาดก่อนจะ Bingo (To-Go)
function calculateMinToGo(boardData) {
  const { grid, rows, cols } = boardData;

  // สำหรับ 1-90 (ครบ 1 แถว หรือ ครบทั้งใบ)
  if (cols === 9) {
    let minNeededInRow = 5;
    for (let r = 0; r < 3; r++) {
      const activeCells = grid[r].filter(c => !c.isBlank);
      const unmarked = activeCells.filter(c => !c.marked).length;
      if (unmarked < minNeededInRow) minNeededInRow = unmarked;
    }
    return minNeededInRow;
  }

  // สำหรับ Square Grids (3x3, 4x4, 5x5)
  let minToGo = rows;

  // แนวนอน
  for (let r = 0; r < rows; r++) {
    const un = grid[r].filter(cell => !cell.marked).length;
    if (un < minToGo) minToGo = un;
  }
  // แนวตั้ง
  for (let c = 0; c < cols; c++) {
    let un = 0;
    for (let r = 0; r < rows; r++) {
      if (!grid[r][c].marked) un++;
    }
    if (un < minToGo) minToGo = un;
  }
  // ทแยงมุม (เฉพาะตารางจัตุรัส)
  if (rows === cols) {
    let d1 = 0, d2 = 0;
    for (let i = 0; i < rows; i++) {
      if (!grid[i][i].marked) d1++;
      if (!grid[i][rows - 1 - i].marked) d2++;
    }
    if (d1 < minToGo) minToGo = d1;
    if (d2 < minToGo) minToGo = d2;
  }

  return minToGo;
}

io.on('connection', (socket) => {
  // สร้างห้องใหม่
  socket.on('create-room', (config) => {
    let pool = [];
    if (config.mode === '1-75') {
      pool = Array.from({ length: 75 }, (_, i) => String(i + 1));
    } else if (config.mode === '1-90') {
      pool = Array.from({ length: 90 }, (_, i) => String(i + 1));
    } else {
      pool = [...new Set(config.customWords)];
    }

    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[roomId] = {
      host: socket.id,
      config,
      pool,
      available: [...pool],
      drawn: [],
      players: {}
    };

    socket.join(roomId);
    socket.emit('room-created', { roomId, config });
  });

  // ผู้เล่นเข้าห้อง
  socket.on('join-room', ({ roomId, name }) => {
    roomId = (roomId || '').toUpperCase();
    const room = rooms[roomId];
    if (!room) return socket.emit('error-msg', 'ไม่พบรหัสห้องนี้');

    const board = generateBoard(room.config);
    const minToGo = calculateMinToGo(board);

    room.players[socket.id] = {
      id: socket.id,
      name,
      board,
      autoMark: false,
      minToGo,
      hasWon: false
    };

    socket.join(roomId);
    socket.emit('joined-success', {
      roomId,
      config: room.config,
      board,
      drawn: room.drawn
    });

    // ส่งข้อมูลนักเรียนทั้งหมดอัปเดตไปที่จอครู
    io.to(room.host).emit('update-students-dashboard', Object.values(room.players));
  });

  // Host กด Call ค่าถัดไป
  socket.on('draw-item', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id || room.available.length === 0) return;

    const idx = Math.floor(Math.random() * room.available.length);
    const item = room.available.splice(idx, 1)[0];
    room.drawn.push(item);

    io.to(roomId).emit('item-drawn', { item, history: room.drawn });

    // ประมวลผล Auto Mark และคำนวณ To-Go ใหม่
    Object.values(room.players).forEach(p => {
      if (p.autoMark) {
        let changed = false;
        p.board.grid.forEach(row => {
          row.forEach(cell => {
            if (cell && cell.val === item && !cell.marked) {
              cell.marked = true;
              changed = true;
            }
          });
        });
        if (changed) {
          io.to(p.id).emit('board-updated', p.board);
        }
      }
      p.minToGo = calculateMinToGo(p.board);
      if (p.minToGo === 0 && !p.hasWon) {
        p.hasWon = true;
        io.to(roomId).emit('game-over', { winner: p.name });
      }
    });

    io.to(room.host).emit('update-students-dashboard', Object.values(room.players));
  });

  // กากบาทช่อง
  socket.on('mark-cell', ({ roomId, r, c }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]) return;

    const p = room.players[socket.id];
    const cell = p.board.grid[r][c];

    if (!cell || cell.isBlank) return;
    if (cell.isFree || room.drawn.includes(cell.val)) {
      cell.marked = !cell.marked;
      p.minToGo = calculateMinToGo(p.board);

      socket.emit('board-updated', p.board);
      io.to(room.host).emit('update-students-dashboard', Object.values(room.players));

      if (p.minToGo === 0 && !p.hasWon) {
        p.hasWon = true;
        io.to(roomId).emit('game-over', { winner: p.name });
      }
    }
  });

  // เปิด/ปิด Auto
  socket.on('toggle-auto', ({ roomId, enabled }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]) {
      const p = room.players[socket.id];
      p.autoMark = enabled;

      if (enabled) {
        let changed = false;
        p.board.grid.forEach(row => {
          row.forEach(cell => {
            if (cell && !cell.isBlank && !cell.marked && (cell.isFree || room.drawn.includes(cell.val))) {
              cell.marked = true;
              changed = true;
            }
          });
        });
        if (changed) {
          p.minToGo = calculateMinToGo(p.board);
          socket.emit('board-updated', p.board);
          io.to(room.host).emit('update-students-dashboard', Object.values(room.players));

          if (p.minToGo === 0 && !p.hasWon) {
            p.hasWon = true;
            io.to(roomId).emit('game-over', { winner: p.name });
          }
        }
      }
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(room.host).emit('update-students-dashboard', Object.values(room.players));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));

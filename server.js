const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function getColumnLetter(colIndex, customHeaders) {
  const defaultLetters = ['B', 'I', 'N', 'G', 'O'];
  if (customHeaders && customHeaders[colIndex]) return customHeaders[colIndex];
  return defaultLetters[colIndex] || '•';
}

function initMasterPool(config) {
  const hdrs = config.headers || ['B', 'I', 'N', 'G', 'O'];
  let masterColumns = {};
  hdrs.forEach(h => masterColumns[h] = []);
  let pool = [];

  if (config.mode === '1-75') {
    masterColumns['B'] = Array.from({ length: 15 }, (_, i) => ({ val: String(i + 1), letter: 'B' }));
    masterColumns['I'] = Array.from({ length: 15 }, (_, i) => ({ val: String(i + 16), letter: 'I' }));
    masterColumns['N'] = Array.from({ length: 15 }, (_, i) => ({ val: String(i + 31), letter: 'N' }));
    masterColumns['G'] = Array.from({ length: 15 }, (_, i) => ({ val: String(i + 46), letter: 'G' }));
    masterColumns['O'] = Array.from({ length: 15 }, (_, i) => ({ val: String(i + 61), letter: 'O' }));
    pool = [...masterColumns['B'], ...masterColumns['I'], ...masterColumns['N'], ...masterColumns['G'], ...masterColumns['O']];
  } else if (config.mode === '1-90') {
    pool = Array.from({ length: 90 }, (_, i) => ({ val: String(i + 1), letter: '' }));
  } else {
    // Custom Words: แบ่งคำผูกตายตัวกับแต่ละคอลัมน์ตามลำดับบรรทัด
    config.customWords.forEach((word, idx) => {
      const colLetter = hdrs[idx % hdrs.length];
      const item = { val: word, letter: colLetter };
      if (!masterColumns[colLetter]) masterColumns[colLetter] = [];
      masterColumns[colLetter].push(item);
      pool.push(item);
    });
  }

  return { pool, masterColumns };
}

function generateSingleBoard(config, masterColumns) {
  const { mode, freeText, gridDim, includeFree, headers } = config;
  const hdrs = headers || ['B', 'I', 'N', 'G', 'O'];

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
        const colLetter = getColumnLetter(c, hdrs);
        if (r === 2 && c === 2 && includeFree) {
          grid[r][c] = { val: freeText || 'Free', letter: colLetter, marked: true, isFree: true };
        } else {
          const pool = cols[c];
          const randIdx = Math.floor(Math.random() * pool.length);
          grid[r][c] = { val: pool.splice(randIdx, 1)[0], letter: colLetter, marked: false, isFree: false };
        }
      }
    }
    return { grid, rows: 5, cols: 5 };
  }

  if (mode === '1-90') {
    const grid = Array.from({ length: 3 }, () => Array(9).fill(null).map(() => ({ val: '', letter: '', marked: false, isBlank: true })));
    const colRanges = [
      [1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
      [50, 59], [60, 69], [70, 79], [80, 90]
    ];
    for (let r = 0; r < 3; r++) {
      const colIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => 0.5 - Math.random()).slice(0, 5);
      colIndices.forEach(c => {
        const [min, max] = colRanges[c];
        const num = Math.floor(Math.random() * (max - min + 1)) + min;
        grid[r][c] = { val: String(num), letter: '', marked: false, isBlank: false };
      });
    }
    return { grid, rows: 3, cols: 9 };
  }

  // Custom Bingo: สุ่มคำจากคอลัมน์ของตัวเองเท่านั้น ทำให้ตัวอักษรหัวแถวตรงกันเสมอ
  const size = parseInt(gridDim) || 5;
  const grid = Array.from({ length: size }, () => []);

  for (let c = 0; c < size; c++) {
    const colLetter = getColumnLetter(c, hdrs);
    const colPool = masterColumns && masterColumns[colLetter] ? [...masterColumns[colLetter]] : [];
    
    // สับเฉพาะคำในคอลัมน์นี้
    const shuffledCol = colPool.sort(() => 0.5 - Math.random());
    let poolIdx = 0;

    for (let r = 0; r < size; r++) {
      const isCenter = size % 2 === 1 && r === Math.floor(size / 2) && c === Math.floor(size / 2);
      if (isCenter && includeFree) {
        grid[r][c] = { val: freeText || 'Free', letter: colLetter, marked: true, isFree: true };
      } else {
        const val = shuffledCol[poolIdx] ? shuffledCol[poolIdx].val : `${colLetter} ${poolIdx + 1}`;
        poolIdx++;
        grid[r][c] = { val, letter: colLetter, marked: false, isFree: false };
      }
    }
  }

  return { grid, rows: size, cols: size };
}

function calculateMinToGo(boardData) {
  const { grid, rows, cols } = boardData;

  if (cols === 9) {
    let minNeeded = 5;
    for (let r = 0; r < 3; r++) {
      const active = grid[r].filter(c => !c.isBlank);
      const unmarked = active.filter(c => !c.marked).length;
      if (unmarked < minNeeded) minNeeded = unmarked;
    }
    return minNeeded;
  }

  let minToGo = rows;
  for (let r = 0; r < rows; r++) {
    const un = grid[r].filter(cell => !cell.marked).length;
    if (un < minToGo) minToGo = un;
  }
  for (let c = 0; c < cols; c++) {
    let un = 0;
    for (let r = 0; r < rows; r++) {
      if (!grid[r][c].marked) un++;
    }
    if (un < minToGo) minToGo = un;
  }
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
  socket.on('create-room', (config) => {
    const { pool, masterColumns } = initMasterPool(config);

    const cardsPerPlayer = parseInt(config.cardsPerPlayer) || 1;
    const totalCardsLimit = parseInt(config.totalCardsLimit) || 30;
    const maxPlayers = Math.floor(totalCardsLimit / cardsPerPlayer);
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();

    rooms[roomId] = {
      host: socket.id,
      config,
      cardsPerPlayer,
      totalCardsLimit,
      maxPlayers,
      usedCardsCount: 0,
      pool,
      available: [...pool],
      drawn: [],
      players: {},
      status: 'waiting',
      countdownTimer: null,
      autoDrawInterval: null,
      autoDrawTimeSec: 7,
      stopOnWinning: true,
      winners: [],
      masterColumns
    };

    socket.join(roomId);
    socket.emit('room-created', {
      roomId,
      config,
      maxPlayers,
      totalCardsLimit,
      masterColumns
    });
  });

  socket.on('join-room', ({ roomId, name }) => {
    roomId = (roomId || '').toUpperCase();
    const room = rooms[roomId];

    if (!room) return socket.emit('error-msg', 'ไม่พบรหัสห้องนี้ในระบบ');
    if (room.status === 'in-progress') return socket.emit('error-msg', 'เกมเริ่มไปแล้ว ไม่สามารถเข้าร่วมได้');
    if (room.usedCardsCount + room.cardsPerPlayer > room.totalCardsLimit) {
      return socket.emit('error-msg', 'ห้องเต็มแล้ว (Bingo Cards หมดแล้ว)');
    }

    const boards = [];
    for (let i = 0; i < room.cardsPerPlayer; i++) {
      const b = generateSingleBoard(room.config, room.masterColumns);
      b.id = i;
      b.minToGo = calculateMinToGo(b);
      boards.push(b);
    }

    room.usedCardsCount += room.cardsPerPlayer;
    room.players[socket.id] = {
      id: socket.id,
      name,
      boards,
      autoMark: false,
      hasWon: false
    };

    socket.join(roomId);
    socket.emit('joined-success', {
      roomId,
      config: room.config,
      boards,
      drawn: room.drawn,
      status: room.status
    });

    const playerNames = Object.values(room.players).map(p => p.name);
    io.to(roomId).emit('update-lobby-players', playerNames);

    io.to(room.host).emit('update-players-dashboard', {
      players: Object.values(room.players),
      usedCards: room.usedCardsCount,
      totalCardsLimit: room.totalCardsLimit,
      maxPlayers: room.maxPlayers
    });
  });

  socket.on('start-game', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id || room.status !== 'waiting') return;

    room.status = 'countdown';
    let count = 3;
    io.to(roomId).emit('game-countdown', count);

    room.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(roomId).emit('game-countdown', count);
      } else {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
        room.status = 'in-progress';
        io.to(roomId).emit('game-started');
      }
    }, 1000);
  });

  socket.on('cancel-countdown', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id || room.status !== 'countdown') return;

    if (room.countdownTimer) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
    }
    room.status = 'waiting';
    io.to(roomId).emit('countdown-cancelled');
  });

  function performDraw(roomId) {
    const room = rooms[roomId];
    if (!room || room.available.length === 0) {
      if (room.autoDrawInterval) {
        clearInterval(room.autoDrawInterval);
        room.autoDrawInterval = null;
        io.to(room.host).emit('auto-draw-stopped');
      }
      return null;
    }

    const idx = Math.floor(Math.random() * room.available.length);
    const item = room.available.splice(idx, 1)[0];
    room.drawn.push(item);

    io.to(roomId).emit('item-drawn', {
      item,
      history: room.drawn,
      previous: room.drawn.length > 1 ? room.drawn[room.drawn.length - 2] : null
    });

    let winnerFound = null;
    Object.values(room.players).forEach(p => {
      let anyBoardChanged = false;
      p.boards.forEach(board => {
        if (p.autoMark) {
          board.grid.forEach(row => {
            row.forEach(cell => {
              if (cell && cell.val === item.val && !cell.marked) {
                cell.marked = true;
                anyBoardChanged = true;
              }
            });
          });
        }
        board.minToGo = calculateMinToGo(board);
        if (board.minToGo === 0 && !p.hasWon) {
          p.hasWon = true;
          winnerFound = p.name;
          if (!room.winners.includes(p.name)) room.winners.push(p.name);
          io.to(roomId).emit('game-over', { winner: p.name, winnersList: room.winners });
        }
      });

      if (anyBoardChanged) {
        io.to(p.id).emit('boards-updated', p.boards);
      }
    });

    io.to(room.host).emit('update-players-dashboard', {
      players: Object.values(room.players),
      usedCards: room.usedCardsCount,
      totalCardsLimit: room.totalCardsLimit,
      maxPlayers: room.maxPlayers
    });

    if (winnerFound && room.stopOnWinning) {
      if (room.autoDrawInterval) {
        clearInterval(room.autoDrawInterval);
        room.autoDrawInterval = null;
        io.to(room.host).emit('auto-draw-stopped');
      }
    }

    return { item, winnerFound };
  }

  socket.on('draw-item', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    performDraw(roomId);
  });

  socket.on('start-auto-draw', ({ roomId, intervalSec, stopOnWin }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;

    room.stopOnWinning = stopOnWin;
    room.autoDrawTimeSec = parseInt(intervalSec) || 7;

    if (room.autoDrawInterval) clearInterval(room.autoDrawInterval);

    room.autoDrawInterval = setInterval(() => {
      performDraw(roomId);
    }, room.autoDrawTimeSec * 1000);

    socket.emit('auto-draw-started');
  });

  socket.on('change-auto-interval', ({ roomId, intervalSec }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;

    room.autoDrawTimeSec = parseInt(intervalSec) || 7;
    if (room.autoDrawInterval) {
      clearInterval(room.autoDrawInterval);
      room.autoDrawInterval = setInterval(() => {
        performDraw(roomId);
      }, room.autoDrawTimeSec * 1000);
    }
  });

  socket.on('stop-auto-draw', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;

    if (room.autoDrawInterval) {
      clearInterval(room.autoDrawInterval);
      room.autoDrawInterval = null;
    }
    socket.emit('auto-draw-stopped');
  });

  socket.on('restart-game', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;

    if (room.autoDrawInterval) {
      clearInterval(room.autoDrawInterval);
      room.autoDrawInterval = null;
      io.to(room.host).emit('auto-draw-stopped');
    }

    const { pool } = initMasterPool(room.config);
    room.available = [...pool];
    room.drawn = [];
    room.winners = [];
    room.status = 'waiting';

    Object.values(room.players).forEach(p => {
      const newBoards = [];
      for (let i = 0; i < room.cardsPerPlayer; i++) {
        const b = generateSingleBoard(room.config, room.masterColumns);
        b.id = i;
        b.minToGo = calculateMinToGo(b);
        newBoards.push(b);
      }
      p.boards = newBoards;
      p.hasWon = false;
      io.to(p.id).emit('boards-updated', p.boards);
    });

    io.to(roomId).emit('game-restarted');

    const playerNames = Object.values(room.players).map(p => p.name);
    io.to(roomId).emit('update-lobby-players', playerNames);

    io.to(room.host).emit('update-players-dashboard', {
      players: Object.values(room.players),
      usedCards: room.usedCardsCount,
      totalCardsLimit: room.totalCardsLimit,
      maxPlayers: room.maxPlayers
    });
  });

  socket.on('mark-cell', ({ roomId, boardIdx, r, c }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]) return;

    const p = room.players[socket.id];
    const board = p.boards[boardIdx];
    if (!board) return;

    const cell = board.grid[r][c];
    if (!cell || cell.isBlank || cell.marked) return;

    const isDrawn = room.drawn.some(d => d.val === cell.val);
    if (cell.isFree || isDrawn) {
      cell.marked = true;
      board.minToGo = calculateMinToGo(board);

      socket.emit('boards-updated', p.boards);
      io.to(room.host).emit('update-players-dashboard', {
        players: Object.values(room.players),
        usedCards: room.usedCardsCount,
        totalCardsLimit: room.totalCardsLimit,
        maxPlayers: room.maxPlayers
      });

      if (board.minToGo === 0 && !p.hasWon) {
        p.hasWon = true;
        if (!room.winners.includes(p.name)) room.winners.push(p.name);
        io.to(roomId).emit('game-over', { winner: p.name, winnersList: room.winners });

        if (room.stopOnWinning && room.autoDrawInterval) {
          clearInterval(room.autoDrawInterval);
          room.autoDrawInterval = null;
          io.to(room.host).emit('auto-draw-stopped');
        }
      }
    }
  });

  socket.on('toggle-auto', ({ roomId, enabled }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]) {
      const p = room.players[socket.id];
      p.autoMark = enabled;

      if (enabled) {
        let changed = false;
        p.boards.forEach(board => {
          board.grid.forEach(row => {
            row.forEach(cell => {
              const isDrawn = room.drawn.some(d => d.val === cell.val);
              if (cell && !cell.isBlank && !cell.marked && (cell.isFree || isDrawn)) {
                cell.marked = true;
                changed = true;
              }
            });
          });
          board.minToGo = calculateMinToGo(board);
          if (board.minToGo === 0 && !p.hasWon) {
            p.hasWon = true;
            if (!room.winners.includes(p.name)) room.winners.push(p.name);
            io.to(roomId).emit('game-over', { winner: p.name, winnersList: room.winners });
            if (room.stopOnWinning && room.autoDrawInterval) {
              clearInterval(room.autoDrawInterval);
              room.autoDrawInterval = null;
              io.to(room.host).emit('auto-draw-stopped');
            }
          }
        });

        if (changed) {
          socket.emit('boards-updated', p.boards);
          io.to(room.host).emit('update-players-dashboard', {
            players: Object.values(room.players),
            usedCards: room.usedCardsCount,
            totalCardsLimit: room.totalCardsLimit,
            maxPlayers: room.maxPlayers
          });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        room.usedCardsCount -= room.cardsPerPlayer;
        delete room.players[socket.id];
        const playerNames = Object.values(room.players).map(p => p.name);
        io.to(roomId).emit('update-lobby-players', playerNames);
        io.to(room.host).emit('update-players-dashboard', {
          players: Object.values(room.players),
          usedCards: room.usedCardsCount,
          totalCardsLimit: room.totalCardsLimit,
          maxPlayers: room.maxPlayers
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

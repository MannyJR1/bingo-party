const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateCustomCard(itemPool) {
  const shuffled = [...itemPool].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 24);

  const grid = [];
  let itemIndex = 0;

  for (let r = 0; r < 5; r++) {
    grid[r] = [];
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) {
        grid[r][c] = { val: 'FREE', marked: true };
      } else {
        grid[r][c] = { val: selected[itemIndex], marked: false };
        itemIndex++;
      }
    }
  }
  return grid;
}

function checkBingo(grid) {
  for (let i = 0; i < 5; i++) {
    if (grid[i].every(cell => cell.marked)) return true;
    if (grid.every(row => row[i].marked)) return true;
  }
  if ([0, 1, 2, 3, 4].every(i => grid[i][i].marked)) return true;
  if ([0, 1, 2, 3, 4].every(i => grid[i][4 - i].marked)) return true;
  return false;
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ customItems }) => {
    let pool = [];
    if (customItems && customItems.length >= 24) {
      pool = [...new Set(customItems)];
    } else {
      pool = Array.from({ length: 75 }, (_, i) => String(i + 1));
    }

    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[roomId] = {
      host: socket.id,
      pool: pool,
      availableItems: [...pool],
      drawnItems: [],
      players: {}
    };

    socket.join(roomId);
    socket.emit('room-created', { roomId, totalItems: pool.length });
  });

  socket.on('join-room', ({ roomId, name }) => {
    roomId = (roomId || '').toUpperCase();
    const room = rooms[roomId];
    if (!room) return socket.emit('error-msg', 'ไม่พบรหัสห้องนี้');

    const card = generateCustomCard(room.pool);
    room.players[socket.id] = {
      name,
      card,
      autoMark: false
    };

    socket.join(roomId);
    socket.emit('joined-success', {
      roomId,
      card,
      drawnItems: room.drawnItems
    });

    io.to(roomId).emit('update-players', Object.values(room.players).map(p => p.name));
  });

  socket.on('toggle-auto', ({ roomId, enabled }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]) {
      room.players[socket.id].autoMark = enabled;

      if (enabled) {
        let changed = false;
        const player = room.players[socket.id];
        player.card.forEach(row => {
          row.forEach(cell => {
            if (!cell.marked && room.drawnItems.includes(cell.val)) {
              cell.marked = true;
              changed = true;
            }
          });
        });
        if (changed) {
          socket.emit('card-updated', player.card);
          if (checkBingo(player.card)) {
            io.to(roomId).emit('game-over', { winner: player.name });
          }
        }
      }
    }
  });

  socket.on('draw-item', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    if (room.availableItems.length === 0) return;

    const randIdx = Math.floor(Math.random() * room.availableItems.length);
    const drawn = room.availableItems.splice(randIdx, 1)[0];
    room.drawnItems.push(drawn);

    io.to(roomId).emit('item-drawn', { drawn, history: room.drawnItems });

    for (const [playerId, player] of Object.entries(room.players)) {
      if (player.autoMark) {
        let hasHit = false;
        player.card.forEach(row => {
          row.forEach(cell => {
            if (cell.val === drawn && !cell.marked) {
              cell.marked = true;
              hasHit = true;
            }
          });
        });

        if (hasHit) {
          io.to(playerId).emit('card-updated', player.card);
          if (checkBingo(player.card)) {
            io.to(roomId).emit('game-over', { winner: player.name });
          }
        }
      }
    }
  });

  socket.on('mark-cell', ({ roomId, r, c }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];
    const cell = player.card[r][c];

    if (cell.val === 'FREE' || room.drawnItems.includes(cell.val)) {
      cell.marked = !cell.marked;
      socket.emit('card-updated', player.card);

      if (checkBingo(player.card)) {
        io.to(roomId).emit('game-over', { winner: player.name });
      }
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(roomId).emit('update-players', Object.values(room.players).map(p => p.name));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
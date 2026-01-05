const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

let players = {}; 

io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    socket.on("join", (data) => {
        const { name, room } = data;
        socket.join(room);
        
        const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
        
        // Assign side based on who joins first
        const side = roomSize === 1 ? 'w' : 'b';
        players[socket.id] = { name, room, side };

        socket.emit("player_side", side);

        if (roomSize === 2) {
            // Find the opponent's name in the same room
            const members = Array.from(io.sockets.adapter.rooms.get(room));
            const opponentId = members.find(id => id !== socket.id);
            const opponentName = players[opponentId]?.name || "Opponent";

            io.to(room).emit("match_found", {
                opponentName: opponentName,
                room: room
            });
        }
    });

    // Synchronize game state between players in the same room
    socket.on("sync_state", (data) => {
        const player = players[socket.id];
        if (player) {
            socket.to(player.room).emit("sync_state_from_server", data);
        }
    });

    socket.on("game_over", (winner) => {
        const player = players[socket.id];
        if (player) io.to(player.room).emit("game_over_from_server", winner);
    });

    socket.on("disconnect", () => {
        delete players[socket.id];
    });
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is listening on port ${PORT}`);
});


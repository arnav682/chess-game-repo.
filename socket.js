const express = require('express');
const path = require('path');
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
// FIX: We must pass 'app' here so Render can see your website
const httpServer = createServer(app); 

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 1. MIDDLEWARE & ROUTING (Moved to top for stability)
app.use(express.static(__dirname)); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. GAME VARIABLES
let totalplayers = 0;
let players = {};
let waiting = { '5': [], '10': [], '15': [] };
let matches = { '5': [], '10': [], '15': [] };

// 3. HELPER FUNCTIONS
function firetotalplayers() {
    io.emit("total_players_count_change", totalplayers);
}

function setupmatch(opponentid, socketid, time) {
    if (players[socketid] && players[opponentid]) {
        players[socketid].emit("match_found", { opponentid: opponentid }, "white", time);
        players[opponentid].emit("match_found", { opponentid: socketid }, "black", time);
        console.log(`Match started: ${time} mins between ${socketid} and ${opponentid}`);

        // Sync Game State
        const sync = (from, to) => {
            from.on("sync_state", ($fen, turn) => to.emit("sync_state_from_server", $fen, turn));
        };
        sync(players[opponentid], players[socketid]);
        sync(players[socketid], players[opponentid]);

        // Game Over
        const gameOver = (from, to) => {
            from.on("game_over", (winner) => to.emit("game_over_from_server", winner));
        };
        gameOver(players[opponentid], players[socketid]);
        gameOver(players[socketid], players[opponentid]);

        // Time Out
        const timeOut = (from, to) => {
            from.on("time_out", (payload) => {
                to.emit("time_out_from_server", payload);
                to.emit("game_over_from_server", payload.winner);
            });
        };
        timeOut(players[opponentid], players[socketid]);
        timeOut(players[socketid], players[opponentid]);
    }
}

// 4. SOCKET CONNECTION
io.on("connection", (socket) => {
    console.log("New Connection:", socket.id);
    players[socket.id] = socket;
    totalplayers++;
    firetotalplayers();

    socket.on("want_to_play", (time) => {
        console.log(`${time} minute game requested by ${socket.id}`);
        if (waiting[time].length > 0) {
            const opponentid = waiting[time].shift();
            matches[time].push([socket.id, opponentid]);
            setupmatch(opponentid, socket.id, time);
        } else {
            if (!waiting[time].includes(socket.id)) {
                waiting[time].push(socket.id);
            }
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        // Clean up waiting lists
        ['5', '10', '15'].forEach(t => {
            waiting[t] = waiting[t].filter(id => id !== socket.id);
        });
        delete players[socket.id];
        totalplayers--;
        firetotalplayers();
    });
});

// 5. SERVER START (Required for Render Scan)
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});


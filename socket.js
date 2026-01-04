const { createServer } = require("http");
const { Server } = require("socket.io");
const httpServer = createServer();
let totalplayers = 0;
let players = {};

let waiting = {
    '5': [],
    '10': [],
    '15': [],
};

let matches = {
    '5': [],
    '10': [],
    '15': [],
};

function firetotalplayers() {
    io.emit("total_players_count_change", totalplayers);
}

function setupmatch(opponentid, socketid, time) {
    players[socketid].emit("match_found", { opponentid: opponentid }, "white", time);
    players[opponentid].emit("match_found", { opponentid: socketid }, "black", time);
    console.log("Match setup with time:", time);

    players[opponentid].on("sync_state", function ($fen, turn) {
        players[socketid].emit("sync_state_from_server", $fen, turn);
    });
    players[socketid].on("sync_state", function ($fen, turn) {
        players[opponentid].emit("sync_state_from_server", $fen, turn);
    });

    players[opponentid].on("game_over", function (winner) {
        players[socketid].emit("game_over_from_server", winner);
    });
    players[socketid].on("game_over", function (winner) {
        players[opponentid].emit("game_over_from_server", winner);
    });

    players[opponentid].on("time_out", function (payload) {
        players[socketid].emit("time_out_from_server", payload);
        players[socketid].emit("game_over_from_server", payload.winner === 'White' ? 'White' : payload.winner);
    });
    players[socketid].on("time_out", function (payload) {
        players[opponentid].emit("time_out_from_server", payload);
        players[opponentid].emit("game_over_from_server", payload.winner === 'White' ? 'White' : payload.winner);
    });
}

function handleplayrequest(time, socket) {
    if (waiting[time].length > 0) {
        const opponentid = waiting[time].splice(0, 1)[0];
        matches[time].push([socket.id, [opponentid]]);
        console.log("Match started between " + socket.id + " and " + opponentid);
        setupmatch(opponentid, socket.id, time); // Pass time to setupmatch!
        return;
    }
    if (!waiting[time].includes(socket.id)) {
        waiting[time].push(socket.id);
    }
}

function fireonconnected(socket) {
    socket.on("want_to_play", function (time) {
        handleplayrequest(time, socket);
        console.log(time + " minutes game requested");
    });
    totalplayers++;
    firetotalplayers();
}

function removefromwaitingperiod(socketid) {
    const foreachloop = [5, 10, 15];
    foreachloop.forEach(element => {
        const index = waiting[element].indexOf(socketid);
        if (index > -1) {
            waiting[element].splice(index, 1);
        }
    });
    console.log("waiting");
}

function Fireondisconnect(socket) {
    removefromwaitingperiod(socket.id);
    console.log("Socket disconnected");
    totalplayers--;
    firetotalplayers();
}

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["*"]
    }
});

io.on("connection", (socket) => {
    console.log(socket.id);
    players[socket.id] = socket;

    fireonconnected(socket);

    socket.on("disconnect", () => Fireondisconnect(socket));
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT,  '0.0.0.0',() => {
    console.log(`Server is listening on port ${PORT}`);
});
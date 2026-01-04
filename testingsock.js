const console = require("console");
const { log } = require("console");
const { createServer } = require("http");
const { Server } = require("socket.io");
PORT = 3000;
const httpServer = createServer();
let totalplayers = 0;
let players = {};
let waiting = {
    '5': [],
    '10': [],
    '15': [],
}

let matches = {
    '5': [],
    '10': [],
    '15': [],
}


function firetotalplayers() {
    io.emit("total_players_count_change", totalplayers);

}
function setupmatch(opponentid, socketid, time) {
    players[socketid].emit("match_found", { opponentid: opponentid }, "white", time);
    players[opponentid].emit("match_found", { opponentid: socketid }, "black", time);
    console.log(time)

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

}

function handleplayrequest(time, socket) {
    if (waiting[time].length > 0) {
        const opponentid = waiting[time].splice(0, 1)[0];
        matches[time].push([socket.id, [opponentid]]);
        console.log("Match started between " + socket.id + " and " + opponentid);
        setupmatch(opponentid, socket.id);
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
    const foreachloop = [10, 15, 20];
    foreachloop.forEach(element => {
        const index = waiting[element].indexOf(socketid);
        if (index > -1) {
            waiting[element].splice(index, 1);
        }
    })
    const index = waiting[element].indexOf(socketid);
    if (index > -1) {
        waiting.splice(index, 1);
    }
    console.log("waiting")
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

    socket.on("disconnect", () => Fireondisconnect(socket))
});

httpServer.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
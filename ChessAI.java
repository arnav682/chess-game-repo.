// ChessAI.java
public class ChessAI {
    private Evaluator evaluator = new Evaluator();
    private Map<Long, Integer> transpositionTable = new HashMap<>();

    public Move playVsAI(Board board, int maxDepth, long timeLimitMs) {
        // Opening book first
        Move opening = getOpeningMove(board);
        if (opening != null) return opening;

        // Iterative deepening search
        return iterativeDeepening(board, maxDepth, timeLimitMs);
    }

    private Move iterativeDeepening(Board board, int maxDepth, long timeLimitMs) {
        long start = System.currentTimeMillis();
        Move bestMove = null;

        for (int depth = 1; depth <= maxDepth; depth++) {
            bestMove = chooseBestMove(board, depth);
            if (System.currentTimeMillis() - start > timeLimitMs) break;
        }
        return bestMove;
    }

    private Move chooseBestMove(Board board, int depth) {
        Move bestMove = null;
        int bestScore = Integer.MIN_VALUE;

        for (Move move : orderMoves(board)) {
            Board copy = board.clone();
            copy.makeMove(move);
            int score = minimax(copy, depth - 1, Integer.MIN_VALUE, Integer.MAX_VALUE, false);
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }
        return bestMove;
    }

    private int minimax(Board board, int depth, int alpha, int beta, boolean maximizingPlayer) {
        long hash = board.getZobristHash();
        if (transpositionTable.containsKey(hash)) {
            return transpositionTable.get(hash);
        }

        if (depth == 0 || board.isGameOver()) {
            int eval = quiescence(board, alpha, beta);
            transpositionTable.put(hash, eval);
            return eval;
        }

        List<Move> moves = orderMoves(board);

        if (maximizingPlayer) {
            int maxEval = Integer.MIN_VALUE;
            for (Move move : moves) {
                Board copy = board.clone();
                copy.makeMove(move);
                int eval = minimax(copy, depth - 1, alpha, beta, false);
                maxEval = Math.max(maxEval, eval);
                alpha = Math.max(alpha, eval);
                if (beta <= alpha) break;
            }
            transpositionTable.put(hash, maxEval);
            return maxEval;
        } else {
            int minEval = Integer.MAX_VALUE;
            for (Move move : moves) {
                Board copy = board.clone();
                copy.makeMove(move);
                int eval = minimax(copy, depth - 1, alpha, beta, true);
                minEval = Math.min(minEval, eval);
                beta = Math.min(beta, eval);
                if (beta <= alpha) break;
            }
            transpositionTable.put(hash, minEval);
            return minEval;
        }
    }

    private int quiescence(Board board, int alpha, int beta) {
        int standPat = evaluator.evaluate(board);
        if (standPat >= beta) return beta;
        if (alpha < standPat) alpha = standPat;

        for (Move move : board.getCaptures()) {
            Board copy = board.clone();
            copy.makeMove(move);
            int score = -quiescence(copy, -beta, -alpha);
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    private List<Move> orderMoves(Board board) {
        List<Move> moves = board.getLegalMoves();
        moves.sort((a, b) -> scoreMove(b) - scoreMove(a));
        return moves;
    }

    private int scoreMove(Move move) {
        if (move.isCapture()) return 1000 + evaluator.getValue(move.getCapturedPiece());
        if (move.isCheck()) return 500;
        return 0;
    }

    private Move getOpeningMove(Board board) {
        String fen = board.getFen();
        if (fen.equals("startpos")) {
            return new Move("e2e4"); // Example opening
        }
        return null;
    }
}

// GameController.java
private ChessAI ai = new ChessAI();

public void playAiBtn() {
    // Only act if it's AI's turn
    if (!game.isWhiteTurn()) {
        // Ask AI for best move
        Move aiMove = ai.playVsAI(game.getBoard(), 5, 2000); 
        // depth = 5, time limit = 2000ms (2 seconds)

        // Apply move
        game.makeMove(aiMove);

        // Update GUI board
        boardUI.update(game.getBoard());

        // Log move
        System.out.println("AI plays: " + aiMove);

        // Check game status
        if (game.isGameOver()) {
            System.out.println("Game Over! Result: " + game.getResult());
        }
    }
}
@RestController
public class ChessController {
    private ChessAI ai = new ChessAI();

    @PostMapping("/ai/move")
    public String getAiMove(@RequestBody String fen) {
        Board board = new Board(fen);
        Move aiMove = ai.playVsAI(board, 5, 2000);
        return aiMove.toString();
    }
}

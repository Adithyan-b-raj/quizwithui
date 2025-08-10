const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // change to your Railway URL later for better security
    methods: ["GET", "POST"]
  }
});

// config
const PORT = process.env.PORT || 3000;
const QUESTION_TIME_SEC = 15; // change this if you want longer/shorter

// load questions
let questions = [];
try {
  questions = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));
} catch (e) {
  console.error("Failed to load questions.json", e);
}

// in-memory state
let scores = {};                // { playerName: score }
let currentQuestion = null;     // { id, text, options, correct }
let answeredOrder = [];         // [ { player, option, time, correct } ] preserving submission order
let lastAnswerTime = {};        // { playerName: timeTaken }
let questionTimer = null;
let questionStartTime = null;

// serve static files
app.use(express.static(path.join(__dirname, "public")));

// convenience routes so /admin /player /projector work without .html
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/player", (req, res) => res.sendFile(path.join(__dirname, "public", "player.html")));
app.get("/projector", (req, res) => res.sendFile(path.join(__dirname, "public", "projector.html")));

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.emit("questionsList", questions);
  socket.emit("scoreUpdate", { scores, lastAnswerTime });

  socket.on("sendQuestion", (qIndex) => {
    if (typeof qIndex !== "number" || !questions[qIndex]) return;
    startQuestion(questions[qIndex]);
    io.emit("newQuestion", {
      id: questions[qIndex].id ?? qIndex,
      text: questions[qIndex].text,
      options: questions[qIndex].options
    });
    io.emit("scoreUpdate", { scores, lastAnswerTime });
    console.log("Admin sent question:", questions[qIndex].text);
  });

  socket.on("join", (playerName) => {
    if (!playerName) return;
    socket.data.playerName = playerName;
    if (!scores[playerName]) scores[playerName] = 0;
    io.emit("scoreUpdate", { scores, lastAnswerTime });
    console.log(`Player joined: ${playerName}`);
  });

  socket.on("submitAnswer", (option) => {
    const playerName = socket.data.playerName;
    if (!playerName) {
      socket.emit("errorMessage", "Please join with a name before answering.");
      return;
    }
    if (!currentQuestion) {
      socket.emit("errorMessage", "There is no active question right now.");
      return;
    }
    const already = answeredOrder.find(a => a.player === playerName);
    if (already) {
      socket.emit("errorMessage", "You already answered this question.");
      return;
    }
    const answeredAt = Date.now();
    const timeTaken = (answeredAt - questionStartTime) / 1000;
    lastAnswerTime[playerName] = timeTaken.toFixed(3);
    const correct = option === currentQuestion.correct;
    answeredOrder.push({ player: playerName, option, timeTaken, correct });

    const correctSoFar = answeredOrder.filter(a => a.correct).length;
    if (correct) {
      const positionIndex = correctSoFar - 1;
      const points = Math.max(10 - positionIndex, 0);
      scores[playerName] = (scores[playerName] || 0) + points;
      socket.emit("yourPoints", { points });
    } else {
      socket.emit("yourPoints", { points: 0 });
    }

    io.emit("scoreUpdate", { scores, lastAnswerTime });
    io.emit("answerUpdate", { player: playerName, option, correct });
    console.log(`Answer from ${playerName}: ${option} (correct: ${correct})`);
  });

  socket.on("endQuestion", () => {
    endCurrentQuestion();
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected:", socket.id);
  });
});

function startQuestion(question) {
  currentQuestion = question;
  answeredOrder = [];
  questionStartTime = Date.now();
  if (questionTimer) clearTimeout(questionTimer);
  questionTimer = setTimeout(() => {
    endCurrentQuestion();
  }, QUESTION_TIME_SEC * 1000);
}

function endCurrentQuestion() {
  if (!currentQuestion) return;
  io.emit("questionEnded", {
    question: { id: currentQuestion.id, text: currentQuestion.text },
    answers: answeredOrder,
    scores
  });
  currentQuestion = null;
  answeredOrder = [];
  questionStartTime = null;
  if (questionTimer) {
    clearTimeout(questionTimer);
    questionTimer = null;
  }
  console.log("Question ended, scoreboard updated.");
}

server.listen(PORT, () => {
  console.log(`Quiz server running on port ${PORT}`);
});

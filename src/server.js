const express = require('express');
const http = require('http');
const { Server} = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const routes = require('./routes');
const socketHandler = require('./socketHandler');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(cors());
app.use(express.json());

app.use('/api', routes);

socketHandler(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor Digiturno corriendo en http://localhost:${PORT}`);
});
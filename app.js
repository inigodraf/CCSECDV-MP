const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const handlebars = require('express-handlebars');

const server = express();

// ✅ Register the 'eq' helper inside express-handlebars
server.engine('hbs', handlebars.engine({
    extname: 'hbs',
    helpers: {
        eq: function(a, b) {
            return Number(a) === Number(b); // Convert both to numbers before comparison
        }
    }
}));

server.set('view engine', 'hbs');

// Middleware setup
server.use(express.json());
server.use(express.urlencoded({ extended: true }));

server.use(express.static('public'));

// Session management
server.use(session({
    secret: 'secureSessionKey',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Import and initialize routes
const routes = require('./controllers/routes');
routes.init(server);

// Start the server
const port = process.env.PORT || 3000;
server.listen(port, function() {
    console.log('Listening at port ' + port);
});

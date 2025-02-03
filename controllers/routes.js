const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const saltRounds = 10;

function errorFn(err) {
    console.log('Error found. Please trace!');
    console.log(err);
}

const db = new sqlite3.Database('./users.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the users database.');
});

db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    profile_photo TEXT,
    password TEXT
)`);

const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const mimetype = filetypes.test(file.mimetype);
        if (mimetype) {
            cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
        } else {
            return cb(new Error('Invalid file type')); 
        }
    }
});
const upload = multer({ storage: storage });

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: 'Too many login attempts, please try again later.'
});

function init(server) {
    server.use(session({
        secret: 'secureSessionKey',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }
    }));
    
    server.use('/read-user', limiter);

    server.get('/', function(req, resp) {
        if (!req.session.logged_in) {
            resp.redirect('/register');
        } else {
            db.all(`SELECT * FROM users`, [], (err, post_data) => {
                if (err) {
                    return resp.render('dialog', {
                        layout: 'index',
                        title: 're*curate',
                        message: 'Database error: ' + err.message
                    });
                }
                resp.render('main', {
                    layout: 'index',
                    title: 're*curate',
                    style: 'main.css',
                    post_data: post_data,
                    user: req.session.user
                });
            });
        }
    });

    server.get('/register', function(req, resp) {
        resp.render('registration', {
            layout: 'index',
            title: 'register to re*curate',
            style: 'form.css'
        });
    });

    server.post('/register', upload.single('profile_photo'), (req, resp) => {
        if (!req.body.full_name || !req.body.email || !req.body.password) {
            return resp.status(400).json({ success: false, message: "Invalid request. Form must be submitted manually." });
        }
    
        const { full_name, email, phone, password, confirm_password } = req.body;
        const profilePhoto = req.file ? `/uploads/${req.file.filename}` : '';
    
        if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
            return resp.render('registration', { message: 'Invalid email format.', layout: 'index', title: 'Register' });
        }
    
        if (!phone.match(/^\d{10}$/)) {
            return resp.render('registration', { message: 'Invalid phone number format. It must be 10 digits.', layout: 'index', title: 'Register' });
        }
    
        if (password !== confirm_password) {
            return resp.render('registration', { message: 'Passwords do not match.', layout: 'index', title: 'Register' });
        }
    
        bcrypt.hash(password, saltRounds, function(err, hash) {
            if (err) return resp.render('registration', { message: 'Error hashing password.', layout: 'index', title: 'Register' });
    
            db.run(`INSERT INTO users (full_name, email, phone, profile_photo, password) VALUES (?, ?, ?, ?, ?)`,
                [full_name, email, phone, profilePhoto, hash],
                function (err) {
                    if (err) {
                        return resp.render('registration', { message: 'Error: ' + err.message, layout: 'index', title: 'Register' });
                    }
                    req.session.logged_in = true;
                    req.session.user = full_name;
                    resp.redirect('/');
                }
            );
        });
    });

    server.get('/login', function(req, resp) {
        resp.render('login', {
            layout: 'index',
            title: 're*curate login',
            style: 'form.css'
        });
    });

    server.post('/read-user', function(req, resp) {
        const { user, pass } = req.body;
    
        db.get(`SELECT * FROM users WHERE email = ?`, [user], (err, row) => {
            if (err) {
                return resp.render('dialog', {
                    layout: 'index',
                    title: 're*curate',
                    style: 'form.css',
                    message: 'Database error: ' + err.message
                });
            }
    
            if (!row) {
                return resp.render('dialog', {
                    layout: 'index',
                    title: 're*curate',
                    style: 'form.css',
                    message: 'User not found.'
                });
            }
    
            bcrypt.compare(pass, row.password, function(err, result) {
                if (result) {
                    req.session.logged_in = true;
                    req.session.user = row.full_name;
                    resp.redirect('/');
                } else {
                    resp.render('dialog', {
                        layout: 'index',
                        title: 're*curate',
                        style: 'form.css',
                        message: 'Invalid password.'
                    });
                }
            });
        });
    });
}

module.exports.init = init;

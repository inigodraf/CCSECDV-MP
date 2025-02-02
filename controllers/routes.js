const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const datamodel = require('../models/datamodel');
datamodel.init();
postModel = datamodel.postModel;
loginModel = datamodel.loginModel;

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
            postModel.find({}).lean().then(function(post_data) {
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
            return resp.json({ success: false, message: 'Invalid email format.' });
        }
    
        if (!phone.match(/^\d{10}$/)) {
            return resp.json({ success: false, message: 'Invalid phone number format. It must be 10 digits.' });
        }
    
        if (password !== confirm_password) {
            return resp.json({ success: false, message: 'Passwords do not match.' });
        }
    
        bcrypt.hash(password, saltRounds, function(err, hash) {
            if (err) return resp.json({ success: false, message: 'Error hashing password.' });
    
            db.run(`INSERT INTO users (full_name, email, phone, profile_photo, password) VALUES (?, ?, ?, ?, ?)`,
                [full_name, email, phone, profilePhoto, hash],
                function (err) {
                    if (err) {
                        return resp.json({ success: false, message: 'Error: ' + err.message });
                    }
                    req.session.logged_in = true;
                    req.session.user = full_name;
                    resp.json({ success: true, redirect: '/' });
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
    
        loginModel.findOne({ user }).then(function(login){
            if (!login) {
                return resp.render('dialog', {
                    layout: 'index',
                    title: 're*curate',
                    style: 'form.css',
                    message: 'User not found.'
                });
            }
    
            bcrypt.compare(pass, login.pass, function(err, result) {
                if (result) {
                    req.session.logged_in = true;
                    req.session.user = user;
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
        }).catch(errorFn);
    });
}

module.exports.init = init;

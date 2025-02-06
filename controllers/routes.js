const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const saltRounds = 10;

const db = new sqlite3.Database('./users.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the users database.');
});

db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    profile_photo TEXT,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0 -- 0 for regular users, 1 for admins
)`);

// ✅ Automatically create an admin account if it does not exist
const defaultAdminEmail = 'admin@gmail.com';
const defaultAdminPassword = 'admin12345';

bcrypt.hash(defaultAdminPassword, saltRounds, function (err, hash) {
    if (err) {
        console.error("Error hashing default admin password:", err.message);
        return;
    }

    db.get(`SELECT * FROM users WHERE email = ?`, [defaultAdminEmail], (err, row) => {
        if (err) {
            console.error("Error checking for existing admin:", err.message);
            return;
        }

        if (!row) {
            db.run(
                `INSERT INTO users (full_name, email, phone, profile_photo, password, is_admin) VALUES (?, ?, ?, ?, ?, ?)`,
                ['Admin User', defaultAdminEmail, '1234567890', '', hash, 1],            
                function (err) {
                    if (err) {
                        console.error("Error inserting default admin:", err.message);
                    } else {
                        console.log("✅ Default admin account created: admin@gmail.com / admin12345");
                    }
                }
            );
        } else {
            console.log("✅ Admin account already exists.");
        }
    });
});

// Configure Multer for Profile Photo Uploads
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
            return resp.redirect('/register');
        } 
        
        // ✅ Redirect admins to admin.hbs
        if (req.session.is_admin) {
            return resp.redirect('/admin');
        }
    
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
                user: req.session.user,
                is_admin: req.session.is_admin
            });
        });
    });

    server.get('/register', function(req, resp) {
        resp.render('registration', {
            layout: 'index',
            title: 'Register to re*curate',
            style: 'form.css'
        });
    });

    server.post('/register', upload.single('profile_photo'), (req, resp) => {
        const { full_name, email, phone, password, confirm_password } = req.body;
        const profilePhoto = req.file ? `/uploads/${req.file.filename}` : '';
    
        // Validate email format
        if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
            return resp.render('registration', { message: '❌ Invalid email format.', layout: 'index', title: 'Register' });
        }
    
        // Validate phone number (only digits and exactly 10 characters)
        if (!phone.match(/^\d{10}$/)) {
            return resp.render('registration', { message: '❌ Invalid phone number format. Must be 10 digits.', layout: 'index', title: 'Register' });
        }
    
        // Validate password match
        if (password !== confirm_password) {
            return resp.render('registration', { message: '❌ Passwords do not match.', layout: 'index', title: 'Register' });
        }
    
        // ✅ Check if the email already exists
        db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
            if (err) {
                console.error("Database Error: ", err.message);
                return resp.render('registration', { message: '❌ Database error. Please try again.', layout: 'index', title: 'Register' });
            }
    
            if (row) {
                // ✅ Show error message if email already exists
                return resp.render('registration', { message: '❌ Email is already registered. Please use a different email.', layout: 'index', title: 'Register' });
            }
    
            // Hash password before storing
            bcrypt.hash(password, saltRounds, function (err, hash) {
                if (err) {
                    console.error("Hashing Error: ", err.message);
                    return resp.render('registration', { message: '❌ Error hashing password.', layout: 'index', title: 'Register' });
                }
    
                const insertQuery = `INSERT INTO users (full_name, email, phone, profile_photo, password, is_admin) VALUES (?, ?, ?, ?, ?, 0)`;
                const values = [full_name, email, phone, profilePhoto, hash];
    
                db.run(insertQuery, values, function (err) {
                    if (err) {
                        console.error("Insert Error: ", err.message);
                        return resp.render('registration', { message: '❌ Error inserting user: ' + err.message, layout: 'index', title: 'Register' });
                    }
    
                    console.log(`✅ New User Registered - Name: ${full_name}, Email: ${email}, Phone: ${phone}`);
    
                    // Log the user in immediately after registration
                    req.session.logged_in = true;
                    req.session.user = full_name;
                    req.session.is_admin = false;
    
                    return resp.redirect('/');
                });
            });
        });
    });
    

    server.get('/login', function(req, resp) {
        resp.render('login', {
            layout: 'index',
            title: 'Login to re*curate',
            style: 'form.css'
        });
    });
    
    
    server.post('/login', (req, resp) => {
        const { email, password } = req.body;
    
        db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
            if (err) {
                return resp.render('login', { message: 'Database error.', layout: 'index', title: 'Login' });
            }
    
            if (!row) {
                return resp.render('login', { message: 'User not found.', layout: 'index', title: 'Login' });
            }
    
            bcrypt.compare(password, row.password, function(err, result) {
                if (err) {
                    return resp.render('login', { message: 'Error checking password.', layout: 'index', title: 'Login' });
                }
    
                if (result) {
                    req.session.logged_in = true;
                    req.session.user = row.full_name;
                    req.session.is_admin = row.is_admin === 1;
    
                    console.log(`User Logged In: ${row.full_name}`);
    
                    // ✅ Redirect admins to admin.hbs
                    return resp.redirect(row.is_admin ? '/admin' : '/');
                } else {
                    return resp.render('login', { message: 'Invalid password.', layout: 'index', title: 'Login' });
                }
            });
        });
    });
    
    

    server.get('/admin', function(req, resp) {
        if (!req.session.logged_in || !req.session.is_admin) {
            return resp.status(403).send('Access denied. Admins only.');
        }
        resp.render('admin', {
            layout: 'index',
            title: 'Admin Dashboard',
            style: 'admin.css',
            user: req.session.user
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
                    req.session.is_admin = row.is_admin === 1;
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

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const saltRounds = 10;
const sessionTimeout = 30 * 60 * 1000;  // 30 minutes

// Logging system
const logStream = fs.createWriteStream('./server.log', { flags: 'a' });

function logAction(action, user = 'System') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${user}] ${action}\n`;
    logStream.write(logEntry);
    console.log(logEntry);
}

// Connect to SQLite database
const db = new sqlite3.Database('./users.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the users database.');
    logAction("Connected to the database");
});

// Create tables if they do not exist
function createTables() {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        profile_photo TEXT,
        password TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_title TEXT,
        post_content TEXT,
        post_image TEXT,
        post_video TEXT,
        user_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
}

// Automatically create an admin account if not exists
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
            db.run(`INSERT INTO users (full_name, email, phone, profile_photo, password, is_admin) VALUES (?, ?, ?, ?, ?, ?)`,
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

// Configure Multer for uploads
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        const filename = Date.now() + path.extname(file.originalname).toLowerCase();
        cb(null, filename);
    }
});

const upload = multer({ storage: storage });

// Rate limiter for login attempts
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts, please try again later.'
});

function init(server) {
    createTables();
    server.use(express.static('public')); // Serve static files
    server.use(express.urlencoded({ extended: true })); // To parse form data
    server.use(session({
        secret: 'secureSessionKey',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: sessionTimeout }
    }));

    server.use('/read-user', limiter);

    server.use((req, res, next) => {
        if (req.session.lastActivity && Date.now() - req.session.lastActivity > sessionTimeout) {
            req.session.destroy(() => {
                logAction("Session expired", req.session.email);
                res.redirect('/login');
            });
        } else {
            req.session.lastActivity = Date.now();
            next();
        }
    });

    /**
     * ✅ LOGIN (DEFAULT SCREEN)
     */
    server.get('/', (req, res) => {
        console.log("🔍 Checking session data:", req.session);
    
        if (!req.session.logged_in) {
            console.log("🔒 User not logged in, redirecting to login.");
            return res.redirect('/login');
        }
    
        console.log("✅ User is logged in, rendering main.hbs");
    
        // Fetch user details
        db.get(`SELECT id, full_name, profile_photo FROM users WHERE id = ?`, [req.session.user_id], (err, userData) => {
            if (err || !userData) {
                console.error("❌ Error retrieving user data:", err ? err.message : "User not found");
                return res.render('dialog', {
                    layout: 'index',
                    title: 're*curate',
                    style: 'form.css', 
                    message: 'User not found or database error.'
                });
            }
    
            console.log("✅ Retrieved user data:", userData);
    
            db.all(`
                SELECT posts.*, users.full_name AS post_user, users.profile_photo, posts.user_id AS post_user_id
                FROM posts 
                JOIN users ON posts.user_id = users.id
                ORDER BY posts.id DESC
            `, [], (err, post_data) => {
            
                if (err) {
                    console.error("❌ Error fetching posts:", err.message);
                    return res.render('dialog', { layout: 'index', title: 'Error', message: 'Database error while fetching posts.' });
                }
            
                console.log("✅ Posts fetched successfully:");
                console.log(post_data); // DEBUG OUTPUT
            
                res.render('main', {
                    layout: 'index',
                    title: 're*curate',
                    style: 'main.css',
                    post_data: post_data,
                    user: userData, 
                    user_id: req.session.user_id, // Ensure user_id is passed
                    is_admin: req.session.is_admin
                });
            });            
        });
    });
    

    server.get('/login', (req, res) => {
        if (req.session.logged_in) {
            console.log("🔓 User already logged in, redirecting to /");
            return res.redirect('/');
        }
    
        console.log("🔑 Rendering login page");
        res.render('login', {
            layout: 'index',
            title: 'Login to re*curate',
            style: 'form.css'
        });
    });
    

    server.post('/login', (req, res) => {
        const { email, password } = req.body;
        
        // 🔍 Debug: Show input credentials (DO NOT log passwords in production)
        console.log("🔍 Login Attempt - Email:", email);
        console.log("🔍 Login Attempt - Password:", password.replace(/./g, '*')); // Mask password for security
    
        // Fetch all users for debugging
        db.all(`SELECT id, full_name, email, is_admin FROM users`, [], (err, users) => {
            if (err) {
                console.error("❌ Error retrieving users:", err.message);
                return res.render('login', { message: 'Database error.', layout: 'index', style: 'form.css', title: 'Login' });
            }
    
            console.log("👥 All Registered Users:", users); // Show all users in terminal
    
            // Look for the user trying to log in
            db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
                if (err || !row) {
                    console.error("❌ User not found:", email);
                    return res.render('login', { message: 'User not found.', layout: 'index', style: 'form.css', title: 'Login' });
                }
    
                // 🔍 Debug: Show retrieved user data from DB (excluding password)
                console.log("✅ Retrieved User Data:", {
                    id: row.id,
                    full_name: row.full_name,
                    email: row.email,
                    is_admin: row.is_admin,
                    profile_photo: row.profile_photo || 'No profile photo'
                });
    
                bcrypt.compare(password, row.password, (err, result) => {
                    if (err || !result) {
                        console.error("❌ Invalid password attempt for:", email);
                        return res.render('login', { message: 'Invalid password.', layout: 'index', style: 'form.css', title: 'Login' });
                    }
    
                    // ✅ Store user session properly
                    req.session.logged_in = true;
                    req.session.user_id = row.id;
                    req.session.user = row.full_name;
                    req.session.profile_photo = row.profile_photo;
                    req.session.is_admin = row.is_admin === 1;
    
                    console.log("✅ User Logged In - Session Data:", req.session);
                    logAction("User logged in", email);
    
                    // 🔥 Redirect Admins to `/admin`, otherwise to `/main`
                    if (row.is_admin === 1) {
                        console.log("🔹 Redirecting Admin User to /admin");
                        return res.redirect('/admin');
                    }
    
                    console.log("🔹 Redirecting Regular User to /main");
                    res.redirect('/main');  
                });
            });
        });
    });
    

    // CREATE POST - Only logged-in users can create posts
    server.post('/create-post', upload.single('file_upload'), (req, res) => {
        if (!req.session.logged_in) {
            console.log("❌ Unauthorized attempt to create a post.");
            return res.status(403).send("You must be logged in to create a post.");
        }

        const userId = req.session.user_id;
        const { post_content } = req.body;
        const post_image = req.file && req.file.mimetype.includes('image') ? `/uploads/${req.file.filename}` : null;
        const post_video = req.file && req.file.mimetype.includes('video') ? `/uploads/${req.file.filename}` : null;

        // Insert the post into the database
        db.run(`INSERT INTO posts (post_content, post_image, post_video, user_id) VALUES (?, ?, ?, ?)`,
            [post_content, post_image, post_video, userId],
            function (err) {
                if (err) {
                    console.error("❌ Error inserting post:", err.message);
                    return res.status(500).send("Error creating post.");
                }

                console.log(`✅ Post successfully created by user ${userId}. Post ID: ${this.lastID}`);
                res.redirect('/main'); // Redirect to main page after posting
            }
        );
    });



    /**
     * ✅ REGISTER ROUTE
     */
    server.get('/register', (req, res) => {
        if (req.session.logged_in) {
            console.log("🔓 User already logged in, redirecting to /");
            return res.redirect('/');
        }
    
        console.log("📋 Rendering registration page");
        res.render('registration', {
            layout: 'index',
            title: 'Register to re*curate',
            style: 'form.css'
        });
    });
    

    server.post('/register', upload.single('profile_photo'), (req, res) => {
        const { full_name, email, phone, password, confirm_password } = req.body;
        const profilePhoto = req.file ? `/uploads/${req.file.filename}` : '';
    
        // Validate input fields
        if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
            return res.render('registration', { message: '❌ Invalid email format.', layout: 'index', style: 'form.css',  title: 'Register' });
        }
    
        if (!phone.match(/^\d{10}$/)) {
            return res.render('registration', { message: '❌ Invalid phone number format. Must be 10 digits.', layout: 'index', style: 'form.css',  title: 'Register' });
        }
    
        if (password !== confirm_password) {
            return res.render('registration', { message: '❌ Passwords do not match.', layout: 'index', style: 'form.css', title: 'Register' });
        }
    
        // Check if the email already exists in the database
        db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
            if (err) {
                console.error("Database Error: ", err.message);
                return res.render('registration', { message: '❌ Database error. Please try again.', layout: 'index', style: 'form.css',  title: 'Register' });
            }
    
            if (row) {
                return res.render('registration', { message: '❌ Email is already registered. Please use a different email.', layout: 'index', style: 'form.css', title: 'Register' });
            }
    
            // Hash password before storing
            bcrypt.hash(password, saltRounds, (err, hash) => {
                if (err) {
                    console.error("Hashing Error: ", err.message);
                    return res.render('registration', { message: '❌ Error hashing password.', layout: 'index', style: 'form.css', title: 'Register' });
                }
    
                const insertQuery = `INSERT INTO users (full_name, email, phone, profile_photo, password, is_admin) VALUES (?, ?, ?, ?, ?, 0)`;
                const values = [full_name, email, phone, profilePhoto, hash];
    
                db.run(insertQuery, values, function (err) {
                    if (err) {
                        console.error("Insert Error: ", err.message);
                        return res.render('registration', { message: '❌ Error inserting user: ' + err.message, layout: 'index', style: 'form.css', title: 'Register' });
                    }
    
                    console.log(`✅ New User Registered - Name: ${full_name}, Email: ${email}, Phone: ${phone}`);
    
                    req.session.logged_in = true;
                    req.session.user = full_name;
                    req.session.is_admin = false;
    
                    return res.redirect('/');
                });
            });
        });
    });

    server.get('/admin', (req, res) => {
        if (!req.session.logged_in || !req.session.is_admin) {
            console.log("❌ Unauthorized access to admin panel.");
            return res.status(403).send("Access denied.");
        }
    
        console.log("✅ Admin logged in, rendering admin.hbs");
    
        res.render('admin', {
            layout: 'index',
            title: 'Admin Dashboard',
            style: 'main.css',
            user: req.session.user
        });
    });
    
    

    /**
     * ✅ READ-USER ROUTE (FIXED)
     */
    server.post('/read-user', (req, res) => {
        const { email, password } = req.body;

        db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
            if (err) {
                return res.render('dialog', {
                    layout: 'index',
                    title: 're*curate',
                    message: 'Database error: ' + err.message
                });
            }

            if (!row) {
                return res.render('dialog', {
                    layout: 'index',
                    title: 're*curate',
                    message: 'User not found.'
                });
            }

            bcrypt.compare(password, row.password, function (err, result) {
                if (result) {
                    req.session.logged_in = true;
                    req.session.user = row.full_name;
                    req.session.is_admin = row.is_admin === 1;
                    res.redirect('/main');
                } else {
                    res.render('dialog', {
                        layout: 'index',
                        title: 're*curate',
                        message: 'Invalid password.'
                    });
                }
            });
        });
    });

    /**
     * ✅ MAIN PAGE (AFTER LOGIN)
     */
    server.get('/main', (req, res) => {
        if (!req.session.logged_in) {
            console.log("🔒 User not logged in, redirecting to /login.");
            return res.redirect('/login');
        }
    
        console.log("✅ User is logged in, fetching user details.");
    
        // Fetch user information
        db.get(`SELECT id, full_name, profile_photo FROM users WHERE id = ?`, [req.session.user_id], (err, userData) => {
            if (err || !userData) {
                console.error("❌ Error retrieving user data:", err ? err.message : "User not found");
                return res.render('dialog', { layout: 'index', title: 'Error', message: 'User not found or database error.' });
            }
    
            console.log("✅ Retrieved user data:", userData);
    
            // Fetch posts ordered by newest first
            db.all(`SELECT posts.*, users.full_name AS post_user, users.profile_photo 
                    FROM posts 
                    JOIN users ON posts.user_id = users.id
                    ORDER BY posts.id DESC`, [], (err, post_data) => {
                if (err) {
                    console.error("❌ Error fetching posts:", err.message);
                    return res.render('dialog', { layout: 'index', title: 'Error', message: 'Database error while fetching posts.' });
                }
    
                console.log("✅ Posts fetched successfully:", post_data);
    
                res.render('main', {
                    layout: 'index',
                    title: 're*curate',
                    style: 'main.css',
                    post_data: post_data,
                    user: userData,
                    user_id: req.session.user_id,
                    is_admin: req.session.is_admin
                });
            });
        });
    });
    
    /**
     * ✅ LOGOUT ROUTE
     */
    server.get('/logout', (req, res) => {
        if (!req.session.logged_in) {
            console.log("🔒 User not logged in, redirecting to login.");
            return res.redirect('/login');
        }

        console.log(`🚪 Logging out user: ${req.session.user}`);
        logAction("User logged out", req.session.email);

        req.session.destroy((err) => {
            if (err) {
                console.error("❌ Error destroying session:", err.message);
                return res.status(500).send("Error logging out.");
            }
            res.redirect('/login');
        });
    });

    // DELETE POST - Only post owner can delete
server.post('/delete-post/:id', (req, res) => {
    const postId = req.params.id;
    const userId = req.session.user_id; // Logged-in user

    db.get(`SELECT * FROM posts WHERE id = ? AND user_id = ?`, [postId, userId], (err, post) => {
        if (err) {
            console.error("❌ Error retrieving post:", err.message);
            return res.status(500).send("Database error.");
        }

        if (!post) {
            console.log("❌ Unauthorized attempt to delete post:", postId);
            return res.status(403).send("Unauthorized action.");
        }

        db.run(`DELETE FROM posts WHERE id = ?`, [postId], (err) => {
            if (err) {
                console.error("❌ Error deleting post:", err.message);
                return res.status(500).send("Error deleting post.");
            }

            console.log(`✅ Post ${postId} deleted by user ${userId}`);
            res.redirect('/main');
        });
    });
});

// EDIT POST - Serve edit form only if the user is the owner
server.get('/edit-post/:id', (req, res) => {
    const postId = req.params.id;
    const userId = req.session.user_id;

    db.get(`SELECT * FROM posts WHERE id = ? AND user_id = ?`, [postId, userId], (err, post) => {
        if (err || !post) {
            console.error("❌ Error retrieving post for editing:", err ? err.message : "Unauthorized attempt.");
            return res.status(403).send("Unauthorized action or post not found.");
        }

        res.render('edit-post', {
            layout: 'index',
            title: 'Edit Post',
            style: 'form.css',
            post: post
        });
    });
});

// UPDATE POST - Only owner can update
server.post('/update-post/:id', (req, res) => {
    const postId = req.params.id;
    const userId = req.session.user_id;
    const updatedContent = req.body.post_content;

    db.get(`SELECT * FROM posts WHERE id = ? AND user_id = ?`, [postId, userId], (err, post) => {
        if (err || !post) {
            console.error("❌ Error retrieving post for update:", err ? err.message : "Unauthorized attempt.");
            return res.status(403).send("Unauthorized action or post not found.");
        }

        db.run(`UPDATE posts SET post_content = ? WHERE id = ?`, [updatedContent, postId], (err) => {
            if (err) {
                console.error("❌ Error updating post:", err.message);
                return res.status(500).send("Error updating post.");
            }

            console.log(`✅ Post ${postId} updated by user ${userId}`);
            res.redirect('/main');
        });
    });
});

    
    

}

module.exports.init = init;

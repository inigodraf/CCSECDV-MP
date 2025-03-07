const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./users.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the SQLite database.');
});

// Create or update users table if not exists
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    profile_photo TEXT,
    password TEXT,
    is_admin INTEGER DEFAULT 0 -- 0 for normal users, 1 for admins
)`);

// Create or update posts table
db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_title TEXT,
    post_user TEXT,
    post_store TEXT,
    post_content TEXT,
    post_image TEXT,   -- Store image file path if any
    post_video TEXT,   -- Store video file path if any
    user_id INTEGER,   -- The user who created the post
    FOREIGN KEY (user_id) REFERENCES users(id)
)`);

// Initialize connection and graceful shutdown
function init() {
    function finalClose() {
        console.log('Closing SQLite connection at the end!');
        db.close();
        process.exit();
    }

    process.on('SIGTERM', finalClose);
    process.on('SIGINT', finalClose);
    process.on('SIGQUIT', finalClose);
}

module.exports = {
    init,
    db
};

import session from "express-session";
import db from "../database.js";

const Store = session.Store;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

export default class SqliteStore extends Store {
  constructor() {
    super();
    this._cleaner = setInterval(() => {
      db.run("DELETE FROM sessions WHERE expired < ?", [Date.now()], () => {});
    }, 60 * 60 * 1000);
    this._cleaner.unref?.();
  }

  async get(sid, callback) {
    try {
      const row = await get("SELECT sess, expired FROM sessions WHERE sid = ?", [sid]);
      if (!row) return callback(null, null);
      if (row.expired < Date.now()) {
        await run("DELETE FROM sessions WHERE sid = ?", [sid]);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
      const expired = Date.now() + maxAge;
      await run(
        `INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired`,
        [sid, JSON.stringify(sess), expired],
      );
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await run("DELETE FROM sessions WHERE sid = ?", [sid]);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async touch(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
      await run("UPDATE sessions SET expired = ? WHERE sid = ?", [Date.now() + maxAge, sid]);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

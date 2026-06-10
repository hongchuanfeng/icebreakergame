// MySQL 数据库连接模块
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config();

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'icebreaker_games',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

console.log('[MySQL Debug] ==========================================');
console.log('[MySQL Debug] MYSQL_HOST:', dbConfig.host);
console.log('[MySQL Debug] MYSQL_PORT:', dbConfig.port);
console.log('[MySQL Debug] MYSQL_USER:', dbConfig.user);
console.log('[MySQL Debug] MYSQL_DATABASE:', dbConfig.database);
console.log('[MySQL Debug] ==========================================');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
    console.log('[MySQL Debug] MySQL connection pool created');
  }
  return pool;
}

async function query(sql, params = []) {
  const connection = getPool();
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } catch (error) {
    console.error('[MySQL Debug] Query error:', error.message);
    throw error;
  }
}

async function getConnection() {
  const connection = getPool();
  return await connection.getConnection();
}

// 获取分类数据
async function getCategories(language = 'en_US') {
  console.log('[MySQL Debug] getCategories called, language:', language);

  try {
    const tableName = language === 'zh-CN' ? 'cn_game_categories' : 'game_categories';
    console.log('[MySQL Debug] Fetching from table:', tableName);

    const results = await query(`SELECT * FROM ${tableName} ORDER BY id ASC`);

    console.log('[MySQL Debug] MySQL response:', {
      dataCount: results ? results.length : 0
    });

    if (results && results.length > 0) {
      console.log('[MySQL Debug] First 3 categories:', results.slice(0, 3).map(c => c.name));
    }

    return results || [];
  } catch (error) {
    console.error('[MySQL Debug] Error in getCategories:', error);
    return [];
  }
}

// 获取游戏数据
async function getGames(language = 'en_US') {
  console.log('[MySQL Debug] getGames called, language:', language);

  try {
    const tableName = language === 'zh-CN' ? 'cn_games' : 'games';
    console.log('[MySQL Debug] Fetching games from table:', tableName);

    const results = await query(`SELECT * FROM ${tableName} ORDER BY id ASC`);

    console.log('[MySQL Debug] Games response: { dataCount:', results.length, '}');

    return results;
  } catch (error) {
    console.error('[MySQL Debug] Error in getGames:', error);
    return [];
  }
}

// 根据分类ID获取游戏
async function getGamesByCategoryId(categoryId, language = 'en_US') {
  try {
    const tableName = language === 'zh-CN' ? 'cn_games' : 'games';

    let sql = `SELECT * FROM ${tableName}`;
    let params = [];

    if (language !== 'zh-CN') {
      sql += ` WHERE category_id = ?`;
      params.push(categoryId);
    }

    sql += ` ORDER BY id ASC`;

    const results = await query(sql, params);
    return results;
  } catch (error) {
    console.error('[MySQL Debug] Error in getGamesByCategoryId:', error);
    return [];
  }
}

// 根据游戏ID和分类ID获取单个游戏
async function getGameById(gameId, categoryId, language = 'en_US') {
  try {
    const tableName = language === 'zh-CN' ? 'cn_games' : 'games';

    let sql = `SELECT * FROM ${tableName} WHERE id = ?`;
    let params = [gameId];

    if (language !== 'zh-CN') {
      sql += ` AND category_id = ?`;
      params.push(categoryId);
    }

    sql += ` LIMIT 1`;

    const results = await query(sql, params);

    if (results && results.length > 0) {
      if (results.length > 1) {
        console.warn(`[getGameById] Found ${results.length} records with id=${gameId}, using the first one`);
      }
      return results[0];
    }

    return null;
  } catch (error) {
    console.error('[MySQL Debug] Error in getGameById:', error);
    return null;
  }
}

// 搜索游戏
async function searchGames(searchQuery, language = 'en_US') {
  try {
    const tableName = language === 'zh-CN' ? 'cn_games' : 'games';

    const results = await query(
      `SELECT * FROM ${tableName} WHERE name LIKE ? ORDER BY id ASC`,
      [`%${searchQuery}%`]
    );

    return results;
  } catch (error) {
    console.error('[MySQL Debug] Error in searchGames:', error);
    return [];
  }
}

// 将 MySQL 数据转换为旧格式（兼容现有代码）
async function transformDataToOldFormat(categories, games, language = 'en_US') {
  const result = [];

  console.log('[transformDataToOldFormat] language:', language);
  console.log('[transformDataToOldFormat] categories count:', categories.length);
  console.log('[transformDataToOldFormat] games count:', games.length);

  const categoryIds = categories.map(cat => cat.id);
  console.log('[transformDataToOldFormat] categoryIds:', categoryIds);

  if (games.length > 0) {
    console.log('[transformDataToOldFormat] First game:', { id: games[0].id, name: games[0].name, category_id: games[0].category_id });
    console.log('[transformDataToOldFormat] Has category_id:', games[0].hasOwnProperty('category_id'));

    const categoryIdCounts = {};
    games.forEach(game => {
      const catId = game.category_id || 'NULL';
      categoryIdCounts[catId] = (categoryIdCounts[catId] || 0) + 1;
    });
    console.log('[transformDataToOldFormat] Games by category_id:', categoryIdCounts);
  }

  const hasCategoryId = games.length > 0 && games[0].hasOwnProperty('category_id');
  console.log('[transformDataToOldFormat] hasCategoryId:', hasCategoryId);

  categories.forEach(category => {
    let categoryGames = [];

    if (games.length > 0 && hasCategoryId) {
      categoryGames = games.filter(game => game.category_id === category.id);
    } else {
      console.warn(`[transformDataToOldFormat] Cannot associate games with categories. games.length: ${games.length}, hasCategoryId: ${hasCategoryId}`);
      categoryGames = [];
    }

    console.log(`[transformDataToOldFormat] Category "${category.name}" (id: ${category.id}) has ${categoryGames.length} games`);

    if (categoryGames.length > 0) {
      result.push({
        id: category.id,
        category: category.name,
        games: categoryGames.map(game => ({
          id: game.id,
          name: game.name,
          link: game.link || '',
          icon: game.icon || '',
          href: game.href || '',
          detail: game.detail || '',
          metadata: game.metadata || {}
        }))
      });
    }
  });

  const categorizedGameIds = new Set();
  result.forEach(cat => {
    cat.games.forEach(game => categorizedGameIds.add(game.id));
  });
  const uncategorizedGames = games.filter(game => !categorizedGameIds.has(game.id));
  console.log('[transformDataToOldFormat] Uncategorized games count:', uncategorizedGames.length);

  console.log('[transformDataToOldFormat] Total result categories:', result.length);
  console.log('[transformDataToOldFormat] Total categorized games:', categorizedGameIds.size);

  return result;
}

// 获取游戏播放次数统计
async function getGamesPlayCount() {
  try {
    const results = await query(`SELECT game_id, play_count FROM game_play_stats`);

    const playCounts = {};
    results.forEach(stat => {
      const key = String(stat.game_id);
      if (!playCounts[key]) {
        playCounts[key] = 0;
      }
      playCounts[key] += stat.play_count || 0;
    });

    return playCounts;
  } catch (error) {
    console.error('[MySQL Debug] Error in getGamesPlayCount:', error);
    return {};
  }
}

// 用户认证相关函数
async function getUserByEmail(email) {
  try {
    const results = await query(
      `SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1`,
      [email.toLowerCase()]
    );
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('[MySQL Debug] Error in getUserByEmail:', error);
    return null;
  }
}

async function createUser(email, passwordHash) {
  try {
    const result = await query(
      `INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, NOW())`,
      [email.toLowerCase(), passwordHash]
    );
    return { id: result.insertId, email: email.toLowerCase() };
  } catch (error) {
    console.error('[MySQL Debug] Error in createUser:', error);
    throw error;
  }
}

async function updateUserPassword(email, passwordHash) {
  try {
    await query(
      `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE email = ?`,
      [passwordHash, email.toLowerCase()]
    );
    return true;
  } catch (error) {
    console.error('[MySQL Debug] Error in updateUserPassword:', error);
    return false;
  }
}

async function emailExists(email) {
  try {
    const results = await query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [email.toLowerCase()]
    );
    return results.length > 0;
  } catch (error) {
    console.error('[MySQL Debug] Error in emailExists:', error);
    return false;
  }
}

// 游戏收藏相关
async function getUserFavorites(userEmail) {
  try {
    const results = await query(
      `SELECT game_id, created_at FROM user_favorites WHERE user_email = ?`,
      [userEmail]
    );
    return results;
  } catch (error) {
    console.error('[MySQL Debug] Error in getUserFavorites:', error);
    return [];
  }
}

async function addFavorite(userEmail, gameId) {
  try {
    await query(
      `INSERT INTO user_favorites (user_email, game_id, created_at) VALUES (?, ?, NOW())`,
      [userEmail, gameId]
    );
    return true;
  } catch (error) {
    console.error('[MySQL Debug] Error in addFavorite:', error);
    return false;
  }
}

async function removeFavorite(userEmail, gameId) {
  try {
    await query(
      `DELETE FROM user_favorites WHERE user_email = ? AND game_id = ?`,
      [userEmail, gameId]
    );
    return true;
  } catch (error) {
    console.error('[MySQL Debug] Error in removeFavorite:', error);
    return false;
  }
}

async function isFavorited(userEmail, gameId) {
  try {
    const results = await query(
      `SELECT id FROM user_favorites WHERE user_email = ? AND game_id = ? LIMIT 1`,
      [userEmail, gameId]
    );
    return results.length > 0;
  } catch (error) {
    console.error('[MySQL Debug] Error in isFavorited:', error);
    return false;
  }
}

// 游戏播放统计
async function recordGamePlay(gameId, userEmail = null) {
  try {
    const existing = await query(
      `SELECT id, play_count FROM game_play_stats WHERE game_id = ? LIMIT 1`,
      [gameId]
    );

    if (existing.length > 0) {
      await query(
        `UPDATE game_play_stats SET play_count = play_count + 1, last_played_at = NOW() WHERE id = ?`,
        [existing[0].id]
      );
    } else {
      await query(
        `INSERT INTO game_play_stats (game_id, user_email, play_count, last_played_at) VALUES (?, ?, 1, NOW())`,
        [gameId, userEmail]
      );
    }
    return true;
  } catch (error) {
    console.error('[MySQL Debug] Error in recordGamePlay:', error);
    return false;
  }
}

// 游戏评价相关
async function getGameReviews(gameId) {
  try {
    const results = await query(
      `SELECT * FROM game_reviews WHERE game_id = ? ORDER BY created_at DESC LIMIT 20`,
      [gameId]
    );
    return results;
  } catch (error) {
    console.error('[MySQL Debug] Error in getGameReviews:', error);
    return [];
  }
}

async function addGameReview(gameId, rating, comment, userEmail) {
  try {
    await query(
      `INSERT INTO game_reviews (game_id, rating, comment, user_email, created_at) VALUES (?, ?, ?, ?, NOW())`,
      [gameId, rating, comment || '', userEmail]
    );
    return true;
  } catch (error) {
    console.error('[MySQL Debug] Error in addGameReview:', error);
    return false;
  }
}

// 联系消息
async function saveContactMessage(name, email, subject, message) {
  try {
    await query(
      `INSERT INTO contact_messages (name, email, topic, message, created_at) VALUES (?, ?, ?, ?, NOW())`,
      [name, email, subject || 'general', message]
    );
    return true;
  } catch (error) {
    console.error('[MySQL Debug] Error in saveContactMessage:', error);
    return false;
  }
}

// 获取用户播放统计
async function getUserPlayStats(userEmail) {
  try {
    const results = await query(
      `SELECT game_id, play_count FROM game_play_stats WHERE user_email = ?`,
      [userEmail]
    );
    return results;
  } catch (error) {
    console.error('[MySQL Debug] Error in getUserPlayStats:', error);
    return [];
  }
}

module.exports = {
  query,
  getPool,
  getCategories,
  getGames,
  getGamesByCategoryId,
  getGameById,
  searchGames,
  transformDataToOldFormat,
  getGamesPlayCount,
  getUserByEmail,
  createUser,
  updateUserPassword,
  emailExists,
  getUserFavorites,
  addFavorite,
  removeFavorite,
  isFavorited,
  recordGamePlay,
  getGameReviews,
  addGameReview,
  saveContactMessage,
  getUserPlayStats
};

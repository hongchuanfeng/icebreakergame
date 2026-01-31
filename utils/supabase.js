// Supabase 客户端连接
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('[Supabase Debug] ==========================================');
console.log('[Supabase Debug] NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '已配置' : '未配置');
console.log('[Supabase Debug] NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseAnonKey ? '已配置' : '未配置');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ Supabase configuration missing!');
  console.error('Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
}

const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

console.log('[Supabase Debug] Supabase client initialized:', supabase ? '成功' : '失败');
console.log('[Supabase Debug] ==========================================');

// 获取分类数据
async function getCategories(language = 'en_US') {
  console.log('[Supabase Debug] getCategories called, language:', language);
  
  if (!supabase) {
    console.error('[Supabase Debug] Supabase client not initialized!');
    return [];
  }

  try {
    // 根据语言选择表
    const tableName = language === 'zh-CN' ? 'cn_game_categories' : 'game_categories';
    console.log('[Supabase Debug] Fetching from table:', tableName);
    
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('id', { ascending: true });

    console.log('[Supabase Debug] Supabase response:', { 
      dataCount: data ? data.length : 0, 
      error: error ? error.message : null 
    });

    if (error) {
      console.error(`[Supabase Debug] Error fetching categories from ${tableName}:`, error);
      return [];
    }

    if (data && data.length > 0) {
      console.log('[Supabase Debug] First 3 categories:', data.slice(0, 3).map(c => c.name));
    }

    return data || [];
  } catch (error) {
    console.error('[Supabase Debug] Error in getCategories:', error);
    return [];
  }
}

// 获取游戏数据
async function getGames(language = 'en_US') {
  console.log('[Supabase Debug] getGames called, language:', language);
  
  if (!supabase) {
    console.error('[Supabase Debug] Supabase client not initialized!');
    return [];
  }

  try {
    // 根据语言选择表：中文版本使用 cn_games，英文版本使用 games
    const tableName = language === 'zh-CN' ? 'cn_games' : 'games';
    console.log('[Supabase Debug] Fetching games from table:', tableName);
    
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('id', { ascending: true });

    console.log('[Supabase Debug] Games response:', { 
      dataCount: data ? data.length : 0, 
      error: error ? error.message : null 
    });

    if (error) {
      console.error(`[Supabase Debug] Error fetching games from ${tableName}:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[Supabase Debug] Error in getGames:', error);
    return [];
  }
}

// 根据分类ID获取游戏
async function getGamesByCategoryId(categoryId, language = 'en_US') {
  if (!supabase) {
    console.error('Supabase client not initialized');
    return [];
  }

  try {
    // 根据语言选择表：中文版本使用 cn_games，英文版本使用 games
    const tableName = language === 'zh-CN' ? 'cn_games' : 'games';
    
    // 构建查询
    let query = supabase
      .from(tableName)
      .select('*');
    
    // 如果表中有 category_id 字段，则使用它过滤
    // 注意：cn_games 表可能没有 category_id，所以需要检查
    // 这里先尝试使用 category_id，如果失败则获取所有游戏（由 transformDataToOldFormat 处理）
    if (language !== 'zh-CN') {
      // 英文版本，games 表有 category_id
      query = query.eq('category_id', categoryId);
    }
    // 中文版本：如果 cn_games 表有 category_id 字段，取消下面的注释
    // else {
    //   query = query.eq('category_id', categoryId);
    // }
    
    const { data, error } = await query.order('id', { ascending: true });

    if (error) {
      console.error(`Error fetching games by category from ${tableName}:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getGamesByCategoryId:', error);
    return [];
  }
}

// 根据游戏ID和分类ID获取单个游戏
async function getGameById(gameId, categoryId, language = 'en_US') {
  if (!supabase) {
    console.error('Supabase client not initialized');
    return null;
  }

  try {
    // 根据语言选择表：中文版本使用 cn_games，英文版本使用 games
    const tableName = language === 'zh-CN' ? 'cn_games' : 'games';
    
    // 构建查询
    let query = supabase
      .from(tableName)
      .select('*')
      .eq('id', gameId);
    
    // 如果表中有 category_id 字段，则使用它过滤
    if (language !== 'zh-CN') {
      // 英文版本，games 表有 category_id
      query = query.eq('category_id', categoryId);
    }
    // 中文版本：如果 cn_games 表有 category_id 字段，取消下面的注释
    // else {
    //   query = query.eq('category_id', categoryId);
    // }
    
    const { data, error } = await query.single();

    if (error) {
      console.error(`Error fetching game by id from ${tableName}:`, error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getGameById:', error);
    return null;
  }
}

// 搜索游戏
async function searchGames(query, language = 'en_US') {
  if (!supabase) {
    console.error('Supabase client not initialized');
    return [];
  }

  try {
    // 根据语言选择表：中文版本使用 cn_games，英文版本使用 games
    const tableName = language === 'zh-CN' ? 'cn_games' : 'games';
    
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .ilike('name', `%${query}%`)
      .order('id', { ascending: true });

    if (error) {
      console.error(`Error searching games from ${tableName}:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in searchGames:', error);
    return [];
  }
}

// 将 Supabase 数据转换为旧格式（兼容现有代码）
async function transformDataToOldFormat(categories, games, language = 'en_US') {
  const result = [];
  
  console.log('[transformDataToOldFormat] language:', language);
  console.log('[transformDataToOldFormat] categories count:', categories.length);
  console.log('[transformDataToOldFormat] games count:', games.length);
  
  if (games.length > 0) {
    console.log('[transformDataToOldFormat] First game:', { id: games[0].id, name: games[0].name });
    console.log('[transformDataToOldFormat] Has category_id:', games[0].hasOwnProperty('category_id'));
  }
  
  // 检查游戏数据是否包含 category_id 字段
  const hasCategoryId = games.length > 0 && games[0].hasOwnProperty('category_id');
  console.log('[transformDataToOldFormat] hasCategoryId:', hasCategoryId);
  
  // 如果是中文版本且没有 category_id，需要从英文版本获取分类信息
  let gamesWithCategoryId = games;
  if (language === 'zh-CN' && !hasCategoryId) {
    console.log('[transformDataToOldFormat] cn_games has no category_id, fetching from games table...');
    try {
      // 从英文版本获取游戏的 category_id
      const { data: enGames, error } = await supabase
        .from('games')
        .select('id, category_id');
      
      if (!error && enGames) {
        console.log('[transformDataToOldFormat] Fetched enGames count:', enGames.length);
        // 创建游戏ID到category_id的映射
        const gameIdToCategoryId = {};
        enGames.forEach(game => {
          if (game.id && game.category_id) {
            gameIdToCategoryId[game.id] = game.category_id;
          }
        });
        
        // 为中文版游戏添加 category_id
        gamesWithCategoryId = games.map(game => ({
          ...game,
          category_id: gameIdToCategoryId[game.id] || null
        }));
        
        console.log('[transformDataToOldFormat] Games with category_id count:', gamesWithCategoryId.filter(g => g.category_id).length);
      }
    } catch (err) {
      console.error('[transformDataToOldFormat] Error fetching enGames:', err);
    }
  }
  
  // 按分类组织游戏
  categories.forEach(category => {
    let categoryGames = [];
    
    // 使用 gamesWithCategoryId（可能已经添加了 category_id）
    if (gamesWithCategoryId.length > 0 && gamesWithCategoryId[0].hasOwnProperty('category_id')) {
      categoryGames = gamesWithCategoryId.filter(game => game.category_id === category.id);
    } else {
      console.warn(`[transformDataToOldFormat] Cannot associate games with categories.`);
      categoryGames = [];
    }
    
    console.log(`[transformDataToOldFormat] Category "${category.name}" has ${categoryGames.length} games`);
    
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
  
  console.log('[transformDataToOldFormat] Total result categories:', result.length);
  return result;
}

module.exports = {
  supabase,
  getCategories,
  getGames,
  getGamesByCategoryId,
  getGameById,
  searchGames,
  transformDataToOldFormat
};


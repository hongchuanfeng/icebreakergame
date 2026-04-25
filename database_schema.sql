-- ============================================
-- Supabase 数据库表结构脚本
-- ============================================

-- 联系消息表
CREATE TABLE IF NOT EXISTS contact_messages (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT 'general',
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 如果表已存在但有问题，删除重建
DROP TABLE IF EXISTS contact_messages;
CREATE TABLE contact_messages (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT 'general',
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 添加注释
COMMENT ON TABLE contact_messages IS '联系表单提交的消息';
COMMENT ON COLUMN contact_messages.id IS '自增主键';
COMMENT ON COLUMN contact_messages.name IS '姓名';
COMMENT ON COLUMN contact_messages.email IS '邮箱地址';
COMMENT ON COLUMN contact_messages.topic IS '主题：general-一般咨询, technical-技术支持, business-商务合作, feedback-意见反馈, other-其他';
COMMENT ON COLUMN contact_messages.message IS '消息内容';
COMMENT ON COLUMN contact_messages.created_at IS '创建时间';

-- 可选：添加索引加速查询
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_topic ON contact_messages(topic);

-- ============================================
-- 其他相关表结构（供参考）
-- ============================================

-- 分类表（英文版）
CREATE TABLE IF NOT EXISTS game_categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en_US',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 分类表（中文版）
CREATE TABLE IF NOT EXISTS cn_game_categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'zh-CN',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 游戏表（英文版）
CREATE TABLE IF NOT EXISTS games (
    gid BIGSERIAL PRIMARY KEY,
    id BIGINT,
    category_id INTEGER NOT NULL REFERENCES game_categories(id),
    name TEXT NOT NULL UNIQUE,
    link TEXT,
    icon TEXT,
    href TEXT,
    detail TEXT,
    language TEXT DEFAULT 'en_US',
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 游戏表（中文版）
CREATE TABLE IF NOT EXISTS cn_games (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    link TEXT,
    icon TEXT,
    href TEXT,
    detail TEXT,
    language TEXT DEFAULT 'zh-CN',
    created_at TIMESTAMPTZ DEFAULT now()
);




-- 创建游戏评价表
CREATE TABLE IF NOT EXISTS game_reviews (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT DEFAULT '',
  user_email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_game_reviews_game_id ON game_reviews(game_id);
CREATE INDEX IF NOT EXISTS idx_game_reviews_created_at ON game_reviews(created_at DESC);

-- ============================================
-- 用户收藏表
-- ============================================
CREATE TABLE IF NOT EXISTS user_favorites (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    game_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_email, game_id)
);

-- 添加注释
COMMENT ON TABLE user_favorites IS '用户收藏的游戏';
COMMENT ON COLUMN user_favorites.id IS '自增主键';
COMMENT ON COLUMN user_favorites.user_email IS '用户邮箱';
COMMENT ON COLUMN user_favorites.game_id IS '游戏ID';
COMMENT ON COLUMN user_favorites.created_at IS '收藏时间';

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_user_favorites_email ON user_favorites(user_email);
CREATE INDEX IF NOT EXISTS idx_user_favorites_game_id ON user_favorites(game_id);

-- ============================================
-- 游戏播放统计表
-- ============================================
CREATE TABLE IF NOT EXISTS game_play_stats (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL,
    user_email VARCHAR(255),
    play_count INTEGER DEFAULT 1,
    last_played_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(game_id, user_email)
);

-- 添加注释
COMMENT ON TABLE game_play_stats IS '用户游戏播放统计，记录用户玩游戏的次数';
COMMENT ON COLUMN game_play_stats.id IS '自增主键';
COMMENT ON COLUMN game_play_stats.game_id IS '游戏ID';
COMMENT ON COLUMN game_play_stats.user_email IS '用户邮箱（可为空，支持匿名统计）';
COMMENT ON COLUMN game_play_stats.play_count IS '播放次数';
COMMENT ON COLUMN game_play_stats.last_played_at IS '最后播放时间';
COMMENT ON COLUMN game_play_stats.created_at IS '首次播放时间';

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_game_play_stats_game_id ON game_play_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_game_play_stats_email ON game_play_stats(user_email);
CREATE INDEX IF NOT EXISTS idx_game_play_stats_play_count ON game_play_stats(play_count DESC);

-- ============================================
-- 用户表（自定义登录系统）
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加注释
COMMENT ON TABLE users IS '用户表，自定义登录系统';
COMMENT ON COLUMN users.id IS '自增主键';
COMMENT ON COLUMN users.email IS '用户邮箱（唯一）';
COMMENT ON COLUMN users.password_hash IS '密码哈希值';
COMMENT ON COLUMN users.created_at IS '注册时间';
COMMENT ON COLUMN users.updated_at IS '更新时间';

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
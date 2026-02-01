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


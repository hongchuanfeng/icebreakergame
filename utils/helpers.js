// 工具函数：获取分类图标
function getCategoryIcon(categoryName) {
    const name = (categoryName || '').toLowerCase();
    
    // 中文 category 匹配
    if (name.includes('为您推荐') || name.includes('推荐')) return '⭐';
    if (name.includes('精选')) return '✨';
    if (name.includes('好友') || name.includes('联机')) return '👥';
    if (name.includes('益智') || name.includes('解谜')) return '🧩';
    if (name.includes('新游戏')) return '🆕';
    if (name.includes('排行榜') || name.includes('挑战')) return '🏆';
    if (name.includes('高级') || name.includes('会员')) return '💎';
    if (name.includes('驾驶') || name.includes('赛车')) return '🚗';
    if (name.includes('休闲')) return '🎯';
    if (name.includes('射击')) return '🔫';
    if (name.includes('动作')) return '⚡';
    if (name.includes('冒险')) return '🗺️';
    if (name.includes('体育')) return '⚽';
    if (name.includes('.io')) return '🌐';
    if (name.includes('本周')) return '👍';
    if (name.includes('平台')) return '🎮';
    if (name.includes('自行车')) return '🏍️';
    if (name.includes('恐怖')) return '👻';
    if (name.includes('火柴人')) return '🕺';
    if (name.includes('飞机')) return '✈️';
    if (name.includes('小游戏') || name.includes('迷你')) return '🎲';
    
    // 英文 category 匹配（保留原有逻辑）
    if (name.includes('top') || name.includes('pick')) return '⭐';
    if (name.includes('featured')) return '✨';
    if (name.includes('friend')) return '👥';
    if (name.includes('thinky') || name.includes('puzzle')) return '🧩';
    if (name.includes('new')) return '🆕';
    if (name.includes('climb') || name.includes('rank')) return '🏆';
    if (name.includes('premium') || name.includes('perk')) return '💎';
    if (name.includes('driving') || name.includes('car') || name.includes('racing')) return '🚗';
    if (name.includes('casual')) return '🎯';
    if (name.includes('shooting')) return '🔫';
    if (name.includes('action')) return '⚡';
    if (name.includes('adventure')) return '🗺️';
    if (name.includes('sport')) return '⚽';
    if (name.includes('recommended')) return '👍';
    if (name.includes('platform')) return '🎮';
    if (name.includes('bike') || name.includes('motorcycle')) return '🏍️';
    if (name.includes('horror')) return '👻';
    if (name.includes('stickman')) return '🕺';
    if (name.includes('airplane') || name.includes('flight')) return '✈️';
    if (name.includes('mini')) return '🎲';
    if (name.includes('clicker')) return '🖱️';
    
    return '🎮';
}

module.exports = {
    getCategoryIcon
};


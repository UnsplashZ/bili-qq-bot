const { formatNumber } = require('../../core/formatters');

/**
 * 渲染投票卡片
 * @param {Object} vote - 投票数据对象
 * @returns {String} HTML 字符串
 */
function renderVoteCard(vote) {
     if (!vote) return '';
     const title = vote.desc || vote.title || '投票';
     const items = vote.items || vote.options || [];
     const totalFromApi = vote.join_num || vote.participant || vote.total || vote.total_num || 0;
     const sumCnt = items.reduce((acc, i) => acc + (i.cnt || 0), 0);
     const total = Math.max(totalFromApi, sumCnt);

     const choiceCnt = vote.choice_cnt || vote.choiceCount || (vote.multi_select ? 2 : 1) || 1;
     const hasVoteImages = items.some(item => item.image);

     return `
        <div class="vote-card">
            <div class="vote-header">
                <svg class="vote-icon" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
                ${title}
            </div>
            <div class="vote-options ${hasVoteImages ? 'with-images' : ''}">
                ${items.map(item => {
                    const cnt = item.cnt || 0;
                    const percent = total > 0 ? Math.round((cnt / total) * 100) : 0;
                    return `
                    <div class="vote-item ${item.image ? 'has-image' : ''}" style="position: relative; overflow: hidden;">
                        ${total > 0 ? `<div class="vote-stat-bar" style="width: ${percent}%;"></div>` : ''}
                        ${item.image ? `<div class="vote-item-image"><img src="${item.image}" /></div>` : ''}
                        <div class="vote-item-content" ${item.image ? 'style="flex-direction:column; gap:8px;"' : ''}>
                            <span class="vote-text">${item.desc || item.name || item.text || ''}</span>
                            ${total > 0 ? `<span class="vote-stat-text">${cnt}票 (${percent}%)</span>` : ''}
                        </div>
                    </div>
                `}).join('')}
            </div>
            <div class="vote-footer">
                <span class="vote-type-text">${choiceCnt > 1 ? '多选' : '单选'}</span>
                <span class="vote-total-text">${formatNumber(total)}人参与</span>
            </div>
        </div>
     `;
}

/**
 * 标准化投票数据
 * @param {Object} v - 原始投票数据
 * @returns {Object|null} 标准化后的投票对象
 */
function normalizeVote(v) {
    if (!v) return null;
    return {
        desc: v.desc || v.title || '',
        items: v.items || v.options || [],
        join_num: v.join_num || v.participant || v.total || v.total_num || 0,
        choice_cnt: v.choice_cnt || v.choiceCount || (v.multi_select ? 2 : 1) || 1
    };
}

/**
 * 从模块中提取投票数据
 * @param {Object} modules - 动态模块对象
 * @returns {Object|null} 标准化后的投票对象
 */
function getVoteFromModules(modules) {
    if (!modules) return null;
    const mi = modules.module_interaction || {};
    let v = mi.vote || mi.vote_info || null;
    if (v && v.vote) v = v.vote;
    if (!v) {
        const major = (modules.module_dynamic || {}).major || {};
        v = major.vote || null;
    }
    if (!v) {
        const additional = (modules.module_dynamic || {}).additional || {};
        v = additional.vote || null;
    }
    return normalizeVote(v);
}

module.exports = {
    renderVoteCard,
    normalizeVote,
    getVoteFromModules
};

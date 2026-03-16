export const LABEL_CONFIG_ITEMS = [
  { key: 'video', label: '视频' },
  { key: 'bangumi', label: '番剧' },
  { key: 'article', label: '专栏' },
  { key: 'live', label: '直播' },
  { key: 'dynamic', label: '动态' },
  { key: 'user', label: '用户' },
  { key: 'interactive_video', label: '互动视频' },
  { key: 'favorite_list', label: '收藏夹' },
  { key: 'audio', label: '音频' },
  { key: 'audio_list', label: '歌单' },
  { key: 'topic', label: '话题' },
  { key: 'channel_series', label: '合集' },
  { key: 'article_list', label: '文集' },
  { key: 'note', label: '笔记' },
  { key: 'cheese_video', label: '课程' },
  { key: 'movie', label: '电影' },
  { key: 'tv', label: '电视剧' },
  { key: 'guocha', label: '国创' },
  { key: 'doc', label: '纪录片' },
  { key: 'variety', label: '综艺' }
];

export const createDefaultLabelConfig = () => Object.fromEntries(
  LABEL_CONFIG_ITEMS.map((item) => [item.key, true])
);

export const mergeLabelConfig = (labels = {}) => Object.fromEntries(
  LABEL_CONFIG_ITEMS.map((item) => [item.key, labels[item.key] ?? true])
);

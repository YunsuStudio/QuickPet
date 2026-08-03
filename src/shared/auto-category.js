'use strict';

const CATEGORY_PROFILES = [
  {
    key: 'security',
    aliases: ['逆向安全', '逆向', '网络安全', '安全工具', '渗透测试', 'security'],
    terms: [
      ['ida pro', 18], ['ida64', 18], ['x64dbg', 18], ['ollydbg', 18], ['ghidra', 18],
      ['dnspy', 17], ['jadx', 17], ['apktool', 16], ['frida', 17], ['burp suite', 17],
      ['wireshark', 16], ['nmap', 16], ['metasploit', 17], ['mitmproxy', 16], ['charles proxy', 14],
      ['fiddler', 14], ['process hacker', 14], ['binary ninja', 17], ['radare2', 17], ['immunity debugger', 17]
    ]
  },
  {
    key: 'ai',
    aliases: ['ai工具', 'ai', '人工智能', '大模型', '智能助手', '生成式ai'],
    terms: [
      ['chatgpt', 18], ['openai', 17], ['claude', 18], ['gemini', 17], ['deepseek', 18],
      ['ollama', 17], ['lm studio', 17], ['comfyui', 18], ['stable diffusion', 18], ['midjourney', 18],
      ['copilot', 16], ['perplexity', 16], ['cursor', 16], ['windsurf', 16], ['dify', 15],
      ['coze', 15], ['扣子', 15], ['通义千问', 17], ['豆包', 16], ['kimi', 16], ['文心一言', 16]
    ]
  },
  {
    key: 'development',
    aliases: ['开发', '开发工具', '编程', '代码', 'ide', 'development', 'developer'],
    terms: [
      ['visual studio code', 18], ['vscode', 18], ['visual studio', 16], ['jetbrains', 17], ['intellij', 17],
      ['pycharm', 17], ['webstorm', 17], ['goland', 17], ['clion', 17], ['android studio', 17],
      ['eclipse', 15], ['github desktop', 16], ['github.com', 14], ['gitlab.com', 14], ['gitkraken', 16], ['docker desktop', 16], ['postman', 15],
      ['apifox', 15], ['dbeaver', 15], ['navicat', 15], ['sublime text', 14], ['notepad++', 14],
      ['dev-c++', 15], ['node.js', 13], ['python', 11], ['git', 9]
    ],
    types: { code: 9 }
  },
  {
    key: 'social',
    aliases: ['社交', '聊天', '通讯', '沟通', '即时通讯', 'social'],
    terms: [
      ['微信', 18], ['wechat', 18], ['企业微信', 17], ['wecom', 17], ['qq', 17],
      ['telegram', 17], ['discord', 17], ['whatsapp', 17], ['signal', 16], ['messenger', 15],
      ['微博', 15], ['weibo', 15], ['小红书', 15], ['xiaohongshu', 15], ['钉钉', 14],
      ['dingtalk', 14], ['飞书', 14], ['lark', 14]
    ]
  },
  {
    key: 'entertainment',
    aliases: ['娱乐', '游戏娱乐', '游戏', '影音娱乐', 'entertainment', 'gaming'],
    terms: [
      ['steam', 18], ['epic games', 18], ['gog galaxy', 17], ['battle.net', 17], ['ubisoft connect', 17],
      ['riot client', 17], ['xbox', 16], ['playstation', 16], ['ea app', 16], ['spotify', 15],
      ['网易云音乐', 15], ['qq音乐', 15], ['哔哩哔哩', 15], ['bilibili', 15], ['netflix', 15],
      ['爱奇艺', 14], ['腾讯视频', 14], ['优酷', 14], ['potplayer', 13], ['vlc', 12]
    ],
    types: { video: 7, audio: 7 }
  },
  {
    key: 'design',
    aliases: ['设计', '创作', '图形设计', 'design'],
    terms: [
      ['photoshop', 17], ['illustrator', 17], ['after effects', 16], ['premiere pro', 16], ['figma', 17],
      ['sketch', 14], ['blender', 16], ['cinema 4d', 16], ['maya', 15], ['autocad', 15],
      ['剪映', 14], ['capcut', 14], ['canva', 14]
    ],
    types: { design: 10, image: 6 }
  },
  {
    key: 'study',
    aliases: ['学习', '课程', '资料', '阅读', 'study'],
    terms: [
      ['anki', 16], ['calibre', 14], ['kindle', 14], ['zotero', 16], ['知网', 15],
      ['coursera', 15], ['udemy', 15], ['duolingo', 15], ['得到', 13]
    ],
    types: { document: 7 }
  },
  {
    key: 'office',
    aliases: ['办公', '工作', 'office', '生产力'],
    terms: [
      ['microsoft 365', 16], ['microsoft word', 16], ['microsoft excel', 16], ['powerpoint', 16], ['wps office', 16],
      ['outlook', 15], ['onenote', 15], ['notion', 15], ['obsidian', 14], ['trello', 14],
      ['slack', 14], ['microsoft teams', 15], ['zoom', 13]
    ]
  }
];

const matcherCache = new Map();
const categoryMatcherCache = new WeakMap();

function normalizeText(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(/[_/\\.-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactText(value = '') {
  return normalizeText(value).replace(/[^\p{L}\p{N}+#]+/gu, '');
}

function matcherFor(rawTerm) {
  if (matcherCache.has(rawTerm)) return matcherCache.get(rawTerm);
  const term = normalizeText(rawTerm);
  let matcher = null;
  if (/^[a-z0-9+# ]+$/i.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    matcher = { pattern: new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i') };
  } else if (term) {
    matcher = { compact: compactText(term) };
  }
  matcherCache.set(rawTerm, matcher);
  return matcher;
}

function matchesTerm(text, compact, rawTerm) {
  const matcher = matcherFor(rawTerm);
  return Boolean(matcher && (matcher.pattern ? matcher.pattern.test(text) : compact.includes(matcher.compact)));
}

function containsTerm(text, rawTerm) {
  return matchesTerm(text, compactText(text), rawTerm);
}

function normalizeCategoryKeywords(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(/[,，;；\n]/);
  const seen = new Set();
  const output = [];
  for (const entry of input) {
    const keyword = String(entry || '').trim().slice(0, 40);
    const key = compactText(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(keyword);
    if (output.length >= 24) break;
  }
  return output;
}

function profileForCategory(category) {
  const categoryName = compactText(category?.name);
  if (!categoryName) return null;
  let best = null;
  for (const profile of CATEGORY_PROFILES) {
    for (const alias of profile.aliases) {
      const normalizedAlias = compactText(alias);
      if (!normalizedAlias) continue;
      const exact = categoryName === normalizedAlias;
      const partial = normalizedAlias.length >= 2 && (categoryName.startsWith(normalizedAlias) || categoryName.endsWith(normalizedAlias));
      if (!exact && !partial) continue;
      const rank = (exact ? 100 : 50) + normalizedAlias.length;
      if (!best || rank > best.rank) best = { profile, rank };
    }
  }
  return best?.profile || null;
}

function matchersForCategory(category) {
  const keywords = normalizeCategoryKeywords(category.keywords);
  const signature = `${category.name || ''}\0${keywords.join('\0')}`;
  const cached = categoryMatcherCache.get(category);
  if (cached?.signature === signature) return cached;
  const matchers = {
    signature,
    categoryName: String(category.name || '').trim(),
    keywords,
    profile: profileForCategory(category)
  };
  categoryMatcherCache.set(category, matchers);
  return matchers;
}

function itemSearchText(item = {}) {
  return normalizeText([
    item.name,
    item.target,
    item.type,
    ...(Array.isArray(item.classificationHints) ? item.classificationHints : [])
  ].filter(Boolean).join(' '));
}

function scoreCategory(item, category, text, compact) {
  const prepared = matchersForCategory(category);
  const keywordHits = prepared.keywords.filter((keyword) => matchesTerm(text, compact, keyword));
  if (keywordHits.length) {
    return { score: 100 + Math.min(30, keywordHits.reduce((sum, keyword) => sum + compactText(keyword).length, 0)), source: 'keyword', reason: keywordHits.join('、') };
  }

  const categoryName = prepared.categoryName;
  if (compactText(categoryName).length >= 2 && matchesTerm(text, compact, categoryName)) {
    return { score: 80 + Math.min(20, compactText(categoryName).length), source: 'name', reason: categoryName };
  }

  const profile = prepared.profile;
  if (!profile) return null;
  const termHits = profile.terms.filter(([term]) => matchesTerm(text, compact, term)).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const termScore = termHits.reduce((sum, [, score]) => sum + score, 0);
  const typeScore = Number(profile.types?.[item.type]) || 0;
  const score = termScore + typeScore;
  if (score < 7) return null;
  return {
    score,
    source: termHits.length ? 'profile' : 'type',
    reason: termHits.length ? termHits.map(([term]) => term).join('、') : item.type
  };
}

function suggestCategory(item, categories = []) {
  const text = itemSearchText(item);
  if (!text) return null;
  const compact = compactText(text);
  const ranked = categories.map((category) => {
    const match = scoreCategory(item, category, text, compact);
    return match ? { category: category.id, ...match } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[1] && ranked[0].score - ranked[1].score < 2) return null;
  return {
    ...ranked[0],
    confidence: ranked[0].score >= 16 ? 'high' : 'medium'
  };
}

module.exports = { CATEGORY_PROFILES, normalizeCategoryKeywords, suggestCategory };

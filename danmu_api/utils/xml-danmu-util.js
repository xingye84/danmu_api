/** 大体积弹幕 XML 组包（独立文件，减少与上游 danmu-util 的 sync 冲突）。 */
export function convertDanmuToXml(danmuData) {
  const comments = danmuData.comments || [];
  if (!Array.isArray(comments) || comments.length === 0) {
    return '<?xml version="1.0" ?>\n<i>\n</i>';
  }

  const parts = new Array(comments.length + 2);
  parts[0] = '<?xml version="1.0" ?>\n<i>\n';
  const idBase = (Date.now() % 100000000) * 1000;
  for (let i = 0; i < comments.length; i++) {
    const pValue = buildBilibiliDanmuP(comments[i], idBase + i);
    parts[i + 1] = '    <d p="' + escapeXmlAttr(pValue) + '">' + escapeXmlText(comments[i].m) + '</d>\n';
  }
  parts[comments.length + 1] = '</i>';
  return parts.join('');
}

function buildBilibiliDanmuP(comment, danmuId) {
  const pValues = comment.p.split(',');
  const time = (parseFloat(pValues[0]) || 0).toFixed(1);
  const mode = pValues[1] || '1';
  const color = pValues[2] || '16777215';
  return `${time},${mode},25,${color},1751533608,0,0,${danmuId}`;
}

// XML 1.0 禁止的控制字符；保留会让客户端 SAX 整包解析失败。
function stripIllegalXmlChars(str) {
  return String(str).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function escapeXmlAttr(str) {
  if (!str) return '';
  return stripIllegalXmlChars(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeXmlText(str) {
  if (!str) return '';
  return stripIllegalXmlChars(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

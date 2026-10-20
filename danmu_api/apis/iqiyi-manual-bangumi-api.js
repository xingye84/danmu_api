// 爱奇艺手动选集详情兼容层。
// 自动搜索/匹配仍使用 dandan-api 的原始详情，不把虚拟合并项带入候选列表。
import { getBangumi } from './dandan-api.js';
import { jsonResponse } from '../utils/http-util.js';
import { appendIqiyiManualMerge } from '../utils/iqiyi-concat-util.js';

export async function getManualBangumi(path, detailStore = null, source = null) {
  const response = await getBangumi(path, detailStore, source);
  if (!response || !response.ok) return response;
  const data = await response.json();
  return jsonResponse(appendIqiyiManualMerge(data), response.status);
}

// 记录爱奇艺分片请求失败，不把内部状态写回分片对象。
const failedSegments = new WeakSet();

export function markIqiyiSegmentFailure(segment) {
  if (segment && typeof segment === 'object') failedSegments.add(segment);
}

export function hasIqiyiSegmentFailure(segment) {
  return !!segment && typeof segment === 'object' && failedSegments.has(segment);
}

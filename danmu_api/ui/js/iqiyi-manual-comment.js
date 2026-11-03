// 爱奇艺手动合并项的请求适配；私有地址不作为通用播放器来源链接展示。
export const iqiyiManualCommentJsContent = /* javascript */ `
function getIqiyiManualCommentAddress(value) {
    const address = String(value || '').trim();
    return address.startsWith('iqiyi-concat:') ? address : '';
}

function buildIqiyiManualCommentUrl(episodeId, format, includeDuration, address) {
    const concatAddress = getIqiyiManualCommentAddress(address);
    const path = concatAddress
        ? '/api/v2/comment?url=' + encodeURIComponent(concatAddress) + '&format='
        : '/api/v2/comment/' + episodeId + '?format=';
    return path + encodeURIComponent(format) + (includeDuration ? '&duration=true' : '');
}
`;

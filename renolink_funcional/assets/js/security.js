(function (root) {
  const pages = new Set(['index.html', 'empresa.html', 'explorar.html', 'ideia.html', 'dashboard.html', 'nova-ideia.html', 'mensagens.html', 'negociacoes.html']);
  function safeRedirect(value) {
    if (typeof value !== 'string' || !/^[a-z-]+\.html(?:\?[^#\\\s]*)?$/.test(value)) return 'dashboard.html';
    const url = new URL(value, 'https://renolink.invalid/');
    if (!pages.has(url.pathname.slice(1))) return 'dashboard.html';
    if (url.pathname === '/ideia.html') {
      const id = url.searchParams.get('id');
      return /^\d+$/.test(id || '') ? `ideia.html?id=${id}` : 'explorar.html';
    }
    return url.pathname.slice(1);
  }
  root.RenoLinkSecurity = { safeRedirect };
  if (typeof module !== 'undefined') module.exports = { safeRedirect };
})(typeof window === 'undefined' ? globalThis : window);

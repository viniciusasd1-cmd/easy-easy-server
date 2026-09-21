// ============================================
// BACKGROUND.JS - EASY&EASY (Atualizado para MV3)
// ============================================

chrome.runtime.onInstalled.addListener(() => {
  // Verifica se a permissão foi realmente carregada pelo Chrome
  if (!chrome.declarativeNetRequest) {
    console.error("[BLOCKER ERRO] A API declarativeNetRequest não está disponível. Verifique se ela está no manifest.json!");
    return;
  }

  // Criação das regras dinâmicas de bloqueio para interceptar os gastos de crédito
  const regrasBloqueio = [
    {
      id: 1,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: "/v1/credit_transactions",
        domains: ["lovable.dev"],
        resourceTypes: ["xmlhttprequest", "main_frame", "sub_frame"]
      }
    },
    {
      id: 2,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: "/v1/credits/consume",
        domains: ["lovable.dev"],
        resourceTypes: ["xmlhttprequest", "main_frame", "sub_frame"]
      }
    }
  ];

  // Aplica as regras no navegador
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2], // Remove regras antigas da memória para não duplicar
    addRules: regrasBloqueio
  }, () => {
    console.log("[BLOCKER] Regras de bloqueio de créditos ativadas com sucesso!");
  });
});
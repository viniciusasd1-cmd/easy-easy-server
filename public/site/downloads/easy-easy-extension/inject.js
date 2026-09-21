// =========================================================================
// INJECT.JS - CORRIGIDO E ATUALIZADO PARA LOVABLE (V5.5+)
// =========================================================================

(function() {
    'use strict';

    // 1. Função para encontrar a caixa de texto do Lovable (Nova Interface)
    function getLovableChatInput() {
        const selectors = [
            '[aria-label="Chat input"][contenteditable="true"]',
            '.tiptap.ProseMirror[contenteditable="true"]',
            '[role="textbox"][contenteditable="true"]',
            'textarea[placeholder*="Message"]',
            '#chat-input'
        ];
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    // 2. Função para ler o texto do editor (ContentEditable ou Textarea)
    function getChatText(input) {
        if (!input) return "";
        if (input.tagName.toLowerCase() === 'textarea') return input.value;
        return input.innerText || input.textContent || "";
    }

    // 3. Função para limpar a caixa após capturar
    function clearChatText(input) {
        if (!input) return;
        if (input.tagName.toLowerCase() === 'textarea') {
            input.value = '';
        } else {
            input.innerHTML = '';
            input.textContent = '';
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 4. Lógica de monitoramento e interceptação
    setInterval(() => {
        const nativeInput = getLovableChatInput();
        
        if (nativeInput && !nativeInput.dataset.easyAttached) {
            nativeInput.dataset.easyAttached = "true";
            console.log("[EASY] Caixa de texto detectada e interceptada!");
            
            nativeInput.addEventListener('keydown', (e) => {
                // Se apertar Enter sem Shift, envia pelo seu sistema
                if (e.key === 'Enter' && !e.shiftKey) {
                    const text = getChatText(nativeInput).trim();
                    
                    if (text) {
                        e.preventDefault(); 
                        e.stopPropagation();
                        
                        console.log("[EASY] Capturando prompt:", text);
                        
                        // Aqui você pode chamar sua função de envio original da EASY
                        // Se você tiver uma função chamada 'sendToAPI(text)', chame-a aqui:
                        // sendToAPI(text); 
                        
                        clearChatText(nativeInput);
                    }
                }
            }, true); 
        }
    }, 1000);

})();
(function() {
  'use strict';

  var SCRIPT_ORIGIN = 'https://ai.korevia.solutions';

  window.HCGIWidget = {
    init: function(configOrAgentId, maybeApiUrl) {
      var agentId, apiUrl;
      if (configOrAgentId && typeof configOrAgentId === 'object') {
        agentId = configOrAgentId.agentId;
        apiUrl = configOrAgentId.apiUrl;
      } else {
        agentId = configOrAgentId;
        apiUrl = maybeApiUrl;
      }
      if (!agentId) {
        return Promise.reject(new Error('agentId is required'));
      }
      if (!apiUrl) {
        apiUrl = SCRIPT_ORIGIN;
      }
      return initializeWidget(agentId, apiUrl).catch(function(error) {
        console.error('[WIDGET] init() failed:', error.message);
        throw error;
      });
    }
  };

  function loadScript(src, globalName) {
    return new Promise((resolve, reject) => {
      if (globalName && window[globalName]) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.addEventListener('load', resolve);
      s.addEventListener('error', () => reject(new Error('Failed to load: ' + src)));
      document.head.appendChild(s);
    });
  }

  function createContainer() {
    let c = document.getElementById('hcgi-chat-widget-container');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'hcgi-chat-widget-container';
    c.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483000;';
    document.body.appendChild(c);
    return c;
  }

  function createChatWidgetComponent(React, agentId, apiUrl) {
    return function ChatWidget() {
      const [open, setOpen] = React.useState(false);
      const [agent, setAgent] = React.useState(null);
      const [agentLoading, setAgentLoading] = React.useState(true);
      const [messages, setMessages] = React.useState([]);
      const [input, setInput] = React.useState('');
      const [loading, setLoading] = React.useState(false);
      const [conversationId, setConversationId] = React.useState(null);
      const [visitorId] = React.useState(function() {
        let id = null;
        try { id = localStorage.getItem('hcgi_visitor_id'); } catch(e){}
        if (!id) {
          id = 'visitor_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
          try { localStorage.setItem('hcgi_visitor_id', id); } catch(e){}
        }
        return id;
      });
      const messagesEndRef = React.useRef(null);

      React.useEffect(function() {
        let cancelled = false;
        (async function() {
          try {
            const r = await fetch(apiUrl + '/hcgi/api/agents', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: agentId }),
            });
            const data = await r.json();
            if (cancelled) return;
            setAgent(data);
            if (data.welcome_message) setMessages([{ role: 'assistant', content: data.welcome_message }]);
          } catch(err) {
            console.error('[WIDGET] Error loading agent:', err);
          } finally {
            if (!cancelled) setAgentLoading(false);
          }
        })();
        return function() { cancelled = true; };
      }, []);

      React.useEffect(function() {
        if (open && messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }, [messages, open]);

      const handleSend = async function() {
        if (!input.trim() || !agent) return;
        const sentInput = input;
        setMessages(function(prev) { return prev.concat([{ role: 'user', content: sentInput }]); });
        setInput('');
        setLoading(true);
        try {
          const r = await fetch(apiUrl + '/hcgi/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agent.id, conversation_id: conversationId, message_content: sentInput, visitor_id: visitorId }),
          });
          const data = await r.json();
          setMessages(function(prev) { return prev.concat([{ role: 'assistant', content: data.content }]); });
          if (!conversationId) setConversationId(data.conversation_id);
        } catch(err) {
          setMessages(function(prev) { return prev.concat([{ role: 'assistant', content: 'Sorry, something went wrong.' }]); });
        } finally {
          setLoading(false);
        }
      };

      const handleKeyDown = function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
      };

      const primaryColor = (agent && agent.colors && agent.colors.primary) || '#0f172a';
      const label = agentLoading ? 'Loading...' : ((agent && agent.name) || 'Chat Support');

      return React.createElement(React.Fragment, null,
        React.createElement('div', { style: { position:'fixed', bottom:'88px', right:'20px', width:'360px', maxWidth:'calc(100vw - 2rem)', height:'500px', maxHeight:'calc(100vh - 6rem)', display: open ? 'flex' : 'none', flexDirection:'column', backgroundColor:'#fff', borderRadius:'12px', boxShadow:'0 20px 25px -5px rgba(0,0,0,0.2)', overflow:'hidden', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', zIndex:2147483000 } },
          React.createElement('div', { style: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', backgroundColor: primaryColor, color:'#fff' } },
            React.createElement('span', { style: { fontWeight:600, fontSize:'15px' } }, label),
            React.createElement('button', { onClick: function() { setOpen(false); }, style: { background:'transparent', border:'none', color:'#fff', cursor:'pointer', fontSize:'18px' } }, '\u00D7')
          ),
          React.createElement('div', { style: { flex:1, overflowY:'auto', padding:'14px', display:'flex', flexDirection:'column', gap:'10px', backgroundColor:'#f8fafc' } },
            agentLoading ? React.createElement('div', { style: { color:'#94a3b8', fontSize:'14px', textAlign:'center', marginTop:'20px' } }, 'Loading...') : null,
            !agentLoading && messages.length === 0 ? React.createElement('div', { style: { color:'#94a3b8', fontSize:'14px', textAlign:'center', marginTop:'20px' } }, 'Start a conversation...') : null,
            !agentLoading && messages.map(function(msg, idx) {
              return React.createElement('div', { key: idx, style: { display:'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' } },
                React.createElement('div', { style: { maxWidth:'80%', padding:'10px 14px', borderRadius:'14px', backgroundColor: msg.role === 'user' ? primaryColor : '#e2e8f0', color: msg.role === 'user' ? '#fff' : '#1e293b', fontSize:'14px', lineHeight:1.45, whiteSpace:'pre-wrap', wordBreak:'break-word' } }, msg.content)
              );
            }),
            loading ? React.createElement('div', { style: { color:'#94a3b8', fontSize:'13px' } }, 'Assistant is typing...') : null,
            React.createElement('div', { ref: messagesEndRef })
          ),
          React.createElement('div', { style: { display:'flex', gap:'8px', padding:'12px', borderTop:'1px solid #e2e8f0', backgroundColor:'#fff' } },
            React.createElement('input', { type:'text', value:input, onChange: function(e) { setInput(e.target.value); }, onKeyDown: handleKeyDown, placeholder:'Type your message...', disabled: loading || agentLoading || !agent, style: { flex:1, padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:'9999px', fontSize:'14px', outline:'none' } }),
            React.createElement('button', { onClick: handleSend, disabled: loading || agentLoading || !agent || !input.trim(), style: { border:'none', borderRadius:'9999px', width:'40px', height:'40px', backgroundColor: primaryColor, color:'#fff', cursor: (!input.trim() || loading) ? 'not-allowed' : 'pointer', opacity: (!input.trim() || loading) ? 0.6 : 1, fontSize:'14px' } }, '\u27A4')
          )
        ),
        React.createElement('button', { onClick: function() { setOpen(!open); }, style: { position:'fixed', bottom:'20px', right:'20px', width:'56px', height:'56px', borderRadius:'9999px', border:'none', backgroundColor: primaryColor, color:'#fff', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2147483000 } },
          React.createElement('span', { dangerouslySetInnerHTML: { __html: open
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
          } })
        )
      );
    };
  }

  async function initializeWidget(agentId, apiUrl) {
    const container = createContainer();
    await Promise.all([
      loadScript('https://unpkg.com/react@18/umd/react.production.min.js', 'React'),
      loadScript('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'ReactDOM'),
    ]);
    const React = window.React;
    const ReactDOM = window.ReactDOM;
    if (!React) throw new Error('React not available');
    if (!ReactDOM) throw new Error('ReactDOM not available');
    const ChatWidget = createChatWidgetComponent(React, agentId, apiUrl);
    ReactDOM.createRoot(container).render(React.createElement(ChatWidget));
  }

})();

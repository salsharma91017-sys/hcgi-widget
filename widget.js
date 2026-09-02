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
      if (!agentId) return Promise.reject(new Error('agentId is required'));
      if (!apiUrl) apiUrl = SCRIPT_ORIGIN;
      return initializeWidget(agentId, apiUrl).catch(function(error) {
        console.error('[WIDGET] init() failed:', error.message);
        throw error;
      });
    }
  };

  function getAvatarUrl(apiUrl, agentId, avatar) {
    if (!avatar) return null;
    return apiUrl + '/hcgi/platform/api/files/agents/' + agentId + '/' + avatar;
  }

  // Convert markdown to safe HTML
  function markdownToHtml(text) {
    // Escape HTML first to prevent XSS
    var escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return escaped
      // Headings ## and ###
      .replace(/^### (.+)$/gm, '<strong>$1</strong>')
      .replace(/^## (.+)$/gm, '<strong>$1</strong>')
      .replace(/^# (.+)$/gm, '<strong>$1</strong>')
      // Bold **text**
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic *text*
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Markdown links [text](url)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:LINKCOLOR;text-decoration:underline;word-break:break-all;">$1</a>')
      // Plain URLs
      .replace(/(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:LINKCOLOR;text-decoration:underline;word-break:break-all;">$1</a>')
      // Phone numbers tel:
      .replace(/(\+?[\d][\d\s\-().]{6,}[\d])/g, function(match) {
        var digits = match.replace(/\D/g, '');
        if (digits.length >= 7 && digits.length <= 15) {
          return '<a href="tel:' + digits + '" style="color:LINKCOLOR;text-decoration:underline;font-weight:600;">' + match + '</a>';
        }
        return match;
      })
      // Horizontal rule ---
      .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0;">')
      // Bullet lists - item
      .replace(/^[-*] (.+)$/gm, '• $1')
      // Numbered lists
      .replace(/^\d+\. (.+)$/gm, function(match, p1) { return '• ' + p1; })
      // Line breaks
      .replace(/\n/g, '<br>');
  }

  function renderMessage(content, primaryColor, isUser) {
    var linkColor = isUser ? '#fff' : primaryColor;
    var html = markdownToHtml(content).replace(/LINKCOLOR/g, linkColor);
    return React.createElement('div', {
      dangerouslySetInnerHTML: { __html: html },
      style: { maxWidth: '80%', padding: '10px 14px', borderRadius: '14px', backgroundColor: isUser ? primaryColor : '#e2e8f0', color: isUser ? '#fff' : '#1e293b', fontSize: '14px', lineHeight: 1.6, wordBreak: 'break-word' }
    });
  }

  function loadScript(src, globalName) {
    return new Promise(function(resolve, reject) {
      if (globalName && window[globalName]) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.addEventListener('load', resolve);
      s.addEventListener('error', function() { reject(new Error('Failed to load: ' + src)); });
      document.head.appendChild(s);
    });
  }

  function createContainer() {
    var c = document.getElementById('hcgi-chat-widget-container');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'hcgi-chat-widget-container';
    c.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483000;';
    document.body.appendChild(c);
    return c;
  }

  function createChatWidgetComponent(React, agentId, apiUrl) {
    return function ChatWidget() {
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;

      var openState = useState(false); var open = openState[0]; var setOpen = openState[1];
      var agentState = useState(null); var agent = agentState[0]; var setAgent = agentState[1];
      var agentLoadingState = useState(true); var agentLoading = agentLoadingState[0]; var setAgentLoading = agentLoadingState[1];
      var messagesState = useState([]); var messages = messagesState[0]; var setMessages = messagesState[1];
      var inputState = useState(''); var input = inputState[0]; var setInput = inputState[1];
      var loadingState = useState(false); var loading = loadingState[0]; var setLoading = loadingState[1];
      var convState = useState(null); var conversationId = convState[0]; var setConversationId = convState[1];
      var avatarErrorState = useState(false); var avatarError = avatarErrorState[0]; var setAvatarError = avatarErrorState[1];
      var visitorIdState = useState(function() {
        var id = null;
        try { id = localStorage.getItem('hcgi_visitor_id'); } catch(e) {}
        if (!id) {
          id = 'visitor_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          try { localStorage.setItem('hcgi_visitor_id', id); } catch(e) {}
        }
        return id;
      });
      var visitorId = visitorIdState[0];
      var messagesEndRef = useRef(null);

      useEffect(function() {
        var cancelled = false;
        (async function() {
          try {
            var r = await fetch(apiUrl + '/hcgi/api/agents', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: agentId }),
            });
            var data = await r.json();
            if (cancelled) return;
            console.log('[WIDGET] Agent data:', data);
            console.log('[WIDGET] Avatar field:', data.avatar);
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

      useEffect(function() {
        if (open && messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }, [messages, open]);

      useEffect(function() { setAvatarError(false); }, [agent]);

      var handleSend = async function() {
        if (!input.trim() || !agent) return;
        var sentInput = input;
        setMessages(function(prev) { return prev.concat([{ role: 'user', content: sentInput }]); });
        setInput('');
        setLoading(true);
        try {
          var r = await fetch(apiUrl + '/hcgi/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agent.id, conversation_id: conversationId, message_content: sentInput, visitor_id: visitorId }),
          });
          var data = await r.json();
          setMessages(function(prev) { return prev.concat([{ role: 'assistant', content: data.content }]); });
          if (!conversationId) setConversationId(data.conversation_id);
        } catch(err) {
          setMessages(function(prev) { return prev.concat([{ role: 'assistant', content: 'Sorry, something went wrong.' }]); });
        } finally {
          setLoading(false);
        }
      };

      var handleKeyDown = function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
      };

      var primaryColor = (agent && agent.colors && agent.colors.primary) || '#0f172a';
      var agentName = (agent && agent.name) || 'Chat Support';
      var rawAvatar = agent && agent.avatar;
      var avatarUrl = (!avatarError && rawAvatar) ? getAvatarUrl(apiUrl, agent.id, rawAvatar) : null;
      var label = agentLoading ? 'Loading...' : agentName;

      function initialsEl(size) {
        var initials = agentName.split(' ').map(function(w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
        return React.createElement('div', {
          style: { width: size + 'px', height: size + 'px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: (size * 0.35) + 'px', fontWeight: 700, color: '#fff', flexShrink: 0 }
        }, initials);
      }

      function avatarEl(size) {
        if (avatarUrl) {
          return React.createElement('img', {
            src: avatarUrl, alt: agentName,
            onError: function() { setAvatarError(true); },
            style: { width: size + 'px', height: size + 'px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(255,255,255,0.4)' }
          });
        }
        return initialsEl(size);
      }

      var chatIconSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
      var closeIconSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

      var chatWindow = React.createElement('div', {
        style: { position: 'fixed', bottom: '88px', right: '20px', width: '360px', maxWidth: 'calc(100vw - 2rem)', height: '500px', maxHeight: 'calc(100vh - 6rem)', display: open ? 'flex' : 'none', flexDirection: 'column', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)', overflow: 'hidden', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', zIndex: 2147483000 }
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: primaryColor, color: '#fff' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            !agentLoading ? avatarEl(36) : null,
            React.createElement('div', null,
              React.createElement('div', { style: { fontWeight: 600, fontSize: '15px', lineHeight: 1.2 } }, label),
              React.createElement('div', { style: { fontSize: '11px', opacity: 0.8, marginTop: '2px' } }, 'Online')
            )
          ),
          React.createElement('button', { onClick: function() { setOpen(false); }, style: { background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', lineHeight: 1, padding: '4px', display: 'flex' } },
            React.createElement('span', { dangerouslySetInnerHTML: { __html: closeIconSVG } })
          )
        ),
        React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#f8fafc' } },
          agentLoading ? React.createElement('div', { style: { color: '#94a3b8', fontSize: '14px', textAlign: 'center', marginTop: '20px' } }, 'Loading...') : null,
          !agentLoading && messages.length === 0 ? React.createElement('div', { style: { color: '#94a3b8', fontSize: '14px', textAlign: 'center', marginTop: '20px' } }, 'Start a conversation...') : null,
          !agentLoading && messages.map(function(msg, idx) {
            var isUser = msg.role === 'user';
            return React.createElement('div', { key: idx, style: { display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '6px' } },
              !isUser ? avatarEl(24) : null,
              renderMessage(msg.content, primaryColor, isUser)
            );
          }),
          loading ? React.createElement('div', { style: { color: '#94a3b8', fontSize: '13px', paddingLeft: '30px' } }, 'Typing...') : null,
          React.createElement('div', { ref: messagesEndRef })
        ),
        React.createElement('div', { style: { display: 'flex', gap: '8px', padding: '12px', borderTop: '1px solid #e2e8f0', backgroundColor: '#fff' } },
          React.createElement('input', { type: 'text', value: input, onChange: function(e) { setInput(e.target.value); }, onKeyDown: handleKeyDown, placeholder: 'Type your message...', disabled: loading || agentLoading || !agent, style: { flex: 1, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '9999px', fontSize: '14px', outline: 'none' } }),
          React.createElement('button', { onClick: handleSend, disabled: loading || agentLoading || !agent || !input.trim(), style: { border: 'none', borderRadius: '9999px', width: '40px', height: '40px', backgroundColor: primaryColor, color: '#fff', cursor: (!input.trim() || loading) ? 'not-allowed' : 'pointer', opacity: (!input.trim() || loading) ? 0.6 : 1, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, '\u27A4')
        )
      );

      var fab = React.createElement('button', {
        onClick: function() { setOpen(!open); },
        title: agentName,
        style: { position: 'fixed', bottom: '20px', right: '20px', width: '60px', height: '60px', borderRadius: '9999px', border: 'none', backgroundColor: primaryColor, color: '#fff', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2147483000, padding: 0, overflow: 'hidden' },
        'aria-label': agentName
      },
        open
          ? React.createElement('span', { dangerouslySetInnerHTML: { __html: closeIconSVG } })
          : avatarUrl && !agentLoading
            ? React.createElement('img', { src: avatarUrl, alt: agentName, onError: function() { setAvatarError(true); }, style: { width: '60px', height: '60px', objectFit: 'cover', borderRadius: '9999px' } })
            : React.createElement('span', { dangerouslySetInnerHTML: { __html: chatIconSVG } })
      );

      var tooltip = !open && !agentLoading ? React.createElement('div', {
        style: { position: 'fixed', bottom: '88px', right: '20px', backgroundColor: '#1e293b', color: '#fff', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', zIndex: 2147483000, fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', pointerEvents: 'none' }
      }, agentName) : null;

      return React.createElement(React.Fragment, null, chatWindow, fab, tooltip);
    };
  }

  async function initializeWidget(agentId, apiUrl) {
    var container = createContainer();
    await Promise.all([
      loadScript('https://unpkg.com/react@18/umd/react.production.min.js', 'React'),
      loadScript('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'ReactDOM'),
    ]);
    var React = window.React;
    var ReactDOM = window.ReactDOM;
    if (!React) throw new Error('React not available');
    if (!ReactDOM) throw new Error('ReactDOM not available');
    var ChatWidget = createChatWidgetComponent(React, agentId, apiUrl);
    ReactDOM.createRoot(container).render(React.createElement(ChatWidget));
  }

})();

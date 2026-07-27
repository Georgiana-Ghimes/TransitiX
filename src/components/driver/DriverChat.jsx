import React, { useEffect, useState, useRef } from 'react';
import { api } from '@/api/client';
import { Send, Loader2, MessageSquare } from 'lucide-react';

export default function DriverChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [userName, setUserName] = useState('Șofer');
  const scrollRef = useRef(null);

  useEffect(() => {
    api.auth.me().then(u => setUserName(u?.full_name || u?.email || 'Șofer')).catch(() => {});
    loadMessages();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const loadMessages = async () => {
    try {
      const data = await api.entities.ChatMessage.list('-created_date', 50);
      // Reverse to show oldest first
      setMessages(data.reverse());
      // Seed initial conversation if empty
      if (data.length === 0) {
        await api.entities.ChatMessage.bulkCreate([
          { sender_role: 'dispatcher', sender_name: 'Dispecer', message: 'Bună ziua! Aici puteți trimite mesaje către dispecerat. Vă răspundem cât mai repede.', is_read: true },
        ]);
        const fresh = await api.entities.ChatMessage.list('-created_date', 50);
        setMessages(fresh.reverse());
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    const msgText = text.trim();
    setText('');
    setSending(true);
    try {
      await api.entities.ChatMessage.create({
        sender_role: 'driver', sender_name: userName, message: msgText,
      });
      await loadMessages();

      // Simulate dispatcher auto-reply after a short delay
      setTimeout(async () => {
        const replies = [
          'Am notat. Mă ocup de asta imediat.',
          'Înțeles, vă rog să continuați cursa.',
          'Mulțumesc pentru informație! Sigur, verific și revin.',
          'Ok, confirmați când ați încărcat marfa.',
          'Recepționat. Aveți grijă pe drum!',
        ];
        const reply = replies[Math.floor(Math.random() * replies.length)];
        await api.entities.ChatMessage.create({
          sender_role: 'dispatcher', sender_name: 'Dispecer', message: reply,
        });
        loadMessages();
      }, 2000);
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-3">
      <h2 className="font-bold text-[#0A2B4E] text-lg">Chat cu dispecerul</h2>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[420px]">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 text-slate-300 animate-spin" /></div>
          ) : messages.length > 0 ? (
            messages.map(m => {
              const isDriver = m.sender_role === 'driver';
              return (
                <div key={m.id} className={`flex ${isDriver ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] ${isDriver ? 'items-end' : 'items-start'}`}>
                    <div className={`px-4 py-2.5 rounded-2xl ${isDriver ? 'bg-[#0A2B4E] text-white rounded-br-md' : 'bg-slate-100 text-slate-700 rounded-bl-md'}`}>
                      <p className="text-sm">{m.message}</p>
                    </div>
                    <p className={`text-xs text-slate-400 mt-1 ${isDriver ? 'text-right' : 'text-left'}`}>
                      {m.sender_name} · {m.created_date ? new Date(m.created_date).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <MessageSquare className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Nu există mesaje. Trimiteți primul mesaj!</p>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="border-t border-slate-100 p-3 flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Scrieți un mesaj..."
            className="flex-1 px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-full focus:outline-none focus:border-[#1D4E89] focus:bg-white transition-colors"
            disabled={sending}
          />
          <button type="submit" disabled={!text.trim() || sending} className="w-11 h-11 flex items-center justify-center bg-[#0A2B4E] text-white rounded-full hover:bg-[#1D4E89] disabled:opacity-50 transition-colors shrink-0">
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
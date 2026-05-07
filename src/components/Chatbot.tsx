import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Bot, User, Loader } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatbotProps {
  currentTemp?: number;
  currentVibration?: number;
  failureProbability?: number;
  healthStatus?: string;
  machineType?: string;
  operatingMode?: string;
}

// ✅ Gemini 2.5 Flash API Key (gratuit sur Google AI Studio)
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

export default function Chatbot({
  currentTemp = 0,
  currentVibration = 0,
  failureProbability = 0,
  healthStatus = 'NORMAL',
  machineType = 'Unknown',
  operatingMode = 'Unknown'
}: ChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Bonjour ! Je suis MotorWatch AI 🤖\n\nJe peux vous aider avec :\n- L'analyse des données capteurs\n- Les recommandations de maintenance\n- Toute question sur votre machine\n\nComment puis-je vous aider ?`
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const getSystemPrompt = () => {
    return `Tu es MotorWatch AI — expert en maintenance industrielle, mécanique, électrotechnique et surveillance de machines.

DONNÉES TEMPS RÉEL DE LA MACHINE :
- Type : ${machineType}
- Mode opératoire : ${operatingMode}
- Température actuelle : ${currentTemp}°C
- Vibration RMS : ${currentVibration} mm/s
- Probabilité de panne : ${failureProbability}%
- État de santé : ${healthStatus}

RÈGLES ABSOLUES :
1. Réponds à CHAQUE question posée — tu ne refuses JAMAIS de répondre.
2. Sois précis et technique : donne des chiffres, des seuils, des causes probables, des actions concrètes.
3. Si la question porte sur les données capteurs, utilise les valeurs ci-dessus et commente-les explicitement.
4. Si la question porte sur la maintenance, donne un plan d'action numéroté avec priorités.
5. Si la question est générale (mécanique, électrique, thermique, vibratoire), réponds avec expertise complète.
6. Réponds dans la langue de l'utilisateur (français ou anglais) sans exception.
7. Ne dis jamais "je ne peux pas" ou "je ne suis pas en mesure" — trouve toujours une réponse utile.
8. Structure tes réponses : contexte → analyse → recommandations → seuils de référence si pertinent.`;
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);

    try {
      // ✅ Format Gemini API : conversation history + system instruction
      const contents = newMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: getSystemPrompt() }]
          },
          contents,
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.3,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Erreur API Gemini');
      }

      // ✅ Extraction de la réponse Gemini
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!reply) {
        throw new Error('Réponse vide de Gemini');
      }

      setMessages([...newMessages, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      console.error('Gemini API error:', err);
      setMessages([...newMessages, {
        role: 'assistant',
        content: `⚠️ Erreur de connexion à l'IA. Vérifiez votre clé VITE_GEMINI_API_KEY.\n\nDétail : ${err?.message || 'Erreur inconnue'}`
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quickQuestions = [
    "Prochaines étapes de maintenance ?",
    "Analyser les données actuelles",
    "Ma machine est-elle en bonne santé ?",
  ];

  return (
    <>
      {/* Bouton flottant */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-[#FFB84E] rounded-full flex items-center justify-center shadow-lg hover:bg-[#ffa31a] transition-all duration-200 z-50 hover:scale-110"
        >
          <MessageCircle className="w-6 h-6 text-[#262525]" />
        </button>
      )}

      {/* Fenêtre de chat */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-80 h-[500px] bg-[#1a1a1a] rounded-2xl border border-gray-700 flex flex-col shadow-2xl z-50 overflow-hidden">

          {/* En-tête */}
          <div className="bg-[#0f0f0f] px-4 py-3 flex items-center justify-between border-b border-gray-700">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-[#FFB84E] rounded-full flex items-center justify-center">
                <Bot className="w-4 h-4 text-[#262525]" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold">MotorWatch AI</p>
                <div className="flex items-center space-x-1">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                  <p className="text-green-400 text-xs">En ligne</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex items-start space-x-2 ${msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${
                  msg.role === 'assistant' ? 'bg-[#FFB84E]' : 'bg-gray-600'
                }`}>
                  {msg.role === 'assistant'
                    ? <Bot className="w-3 h-3 text-[#262525]" />
                    : <User className="w-3 h-3 text-white" />
                  }
                </div>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'assistant'
                    ? 'bg-[#262525] text-gray-200 border border-gray-700'
                    : 'bg-[#FFB84E] text-[#262525] font-medium'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Indicateur de chargement */}
            {loading && (
              <div className="flex items-start space-x-2">
                <div className="w-6 h-6 rounded-full bg-[#FFB84E] flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-3 h-3 text-[#262525]" />
                </div>
                <div className="bg-[#262525] border border-gray-700 px-3 py-2 rounded-xl">
                  <Loader className="w-4 h-4 text-[#FFB84E] animate-spin" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Questions rapides */}
          {messages.length <= 1 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1">
              {quickQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q)}
                  className="text-xs bg-[#262525] text-[#FFB84E] border border-[#FFB84E]/30 px-2 py-1 rounded-full hover:bg-[#FFB84E]/10 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Zone de saisie */}
          <div className="p-3 border-t border-gray-700">
            <div className="flex items-center space-x-2 bg-[#262525] border border-gray-600 rounded-xl px-3 py-2 focus-within:border-[#FFB84E] transition-colors">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Posez votre question..."
                className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 outline-none"
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="w-7 h-7 bg-[#FFB84E] rounded-lg flex items-center justify-center disabled:opacity-40 hover:bg-[#ffa31a] transition-colors flex-shrink-0"
              >
                <Send className="w-3 h-3 text-[#262525]" />
              </button>
            </div>
            <p className="text-gray-600 text-xs text-center mt-1">Propulsé par Gemini 2.5 Flash</p>
          </div>
        </div>
      )}
    </>
  );
}
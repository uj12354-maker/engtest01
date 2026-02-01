import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, Plus, Minus, Menu, X, RotateCcw, Folder, Layers, ChevronLeft, ChevronRight, HelpCircle, Search, CornerDownRight, ChevronsUpDown, BookOpen, Volume2, Quote, GitBranch } from 'lucide-react';
import * as XLSX from 'xlsx';

// --- Types ---

interface CardSection {
  type: 'definition' | 'collocation' | 'example' | 'word_family' | 'other';
  title: string;
  content: string;
}

interface ParsedCard {
  id: string;
  category: string;
  front: string; // The Word
  backOriginal: string;
  parsed: {
    pos: string[];
    sections: CardSection[];
  };
}

// --- Helpers ---

// Robust CSV Line Parser handles quotes containing commas
const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"'; // handle escaped quote
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (char === ',' && !inQuote) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

// Helper to strip Chinese characters for TTS
const getEnglishTextOnly = (text: string) => {
  // Removes Chinese characters, full-width punctuation common in Chinese
  return text.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e]/g, '').trim();
};

// Advanced parser to handle specific tags: 【中文】, 【搭配詞】, 【例句】, 【詞性變化】
const parseBackContent = (text: string, front: string) => {
  if (!text) return { pos: [], sections: [] };

  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Common POS indicators
  const posRegex = /\b(n\.|v\.|adj\.|adv\.|vt\.|vi\.|prep\.|conj\.|interj\.|pron\.|noun|verb|adjective|adverb)\b/gi;
  
  let pos: string[] = [];
  
  // 1. Extract POS from Front (e.g. "animal (n.)")
  const frontPosMatch = front.match(/\((.*?)\)/);
  if (frontPosMatch && posRegex.test(frontPosMatch[1])) {
      pos.push(frontPosMatch[1]);
  }

  // 2. Parse Structured Content using 【Brackets】
  const sections: CardSection[] = [];
  
  // Split strictly by the specific tags requested
  if (cleanText.includes('【')) {
      // We look for these specific headers
      const rawParts = cleanText.split(/(?=【(?:中文|搭配詞|例句|詞性變化)】)/);
      
      rawParts.forEach(part => {
          const trimmed = part.trim();
          if (!trimmed) return;

          const match = trimmed.match(/^【(.*?)】([\s\S]*)/);
          if (match) {
              const title = match[1].trim();
              const content = match[2].trim();
              
              let type: CardSection['type'] = 'other';
              
              if (title === '中文') {
                  type = 'definition';
              }
              else if (title === '搭配詞') {
                  type = 'collocation';
              }
              else if (title === '例句') {
                  type = 'example';
              } 
              else if (title === '詞性變化') {
                  type = 'word_family';
              } else {
                  type = 'other';
              }

              sections.push({ type, title, content });
          } else {
             // Content before the first tag, usually definition or POS
             if (trimmed.length > 0) {
                 sections.push({ type: 'definition', title: '', content: trimmed });
             }
          }
      });
  } else {
      // Fallback: Entire text is definition
      sections.push({ type: 'definition', title: '', content: cleanText.trim() });
  }

  return { pos, sections };
};

// --- Components ---

const FileUploader = ({ onUpload }: { onUpload: (data: ParsedCard[]) => void }) => {
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const processFile = (file: File) => {
    setErrorMsg(null);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');

      const cards: ParsedCard[] = [];
      let lastCard: ParsedCard | null = null;

      if (isExcel) {
        try {
          const workbook = XLSX.read(buffer, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          rows.forEach((row, index) => {
            // Normalize columns
            const cols = row.map(cell => (cell === null || cell === undefined) ? '' : String(cell).trim());
            // Drop trailing empty columns
            while (cols.length > 0 && !cols[cols.length - 1]) cols.pop();
            
            if (cols.length === 0) return;

            // Header Check
            if (index === 0) {
                 const rowStr = cols.join(' ').toLowerCase();
                 if ((rowStr.includes('class') && rowStr.includes('word')) ||
                     (rowStr.includes('category') && rowStr.includes('front'))) {
                     return;
                 }
            }

            let category = '';
            let front = '';
            let back = '';

            // Handle Continuation (if only one column and looks like continuation)
            if (cols.length === 1 && lastCard) {
                 const content = cols[0];
                 if (content.startsWith('【') || content.startsWith('-') || content.startsWith('(') || /^[A-Za-z]/.test(content)) {
                     lastCard.backOriginal += '\n' + content;
                     lastCard.parsed = parseBackContent(lastCard.backOriginal, lastCard.front);
                     return;
                 }
            }

            if (cols.length >= 3) {
                category = cols[0];
                front = cols[1];
                back = cols.slice(2).join(', ');
            } else if (cols.length === 2) {
                front = cols[0];
                back = cols[1];
            } else if (cols.length === 1) {
                front = cols[0];
            }

            if (front) {
                const newCard = {
                    id: `card-${index}`,
                    category,
                    front,
                    backOriginal: back,
                    parsed: parseBackContent(back, front)
                };
                cards.push(newCard);
                lastCard = newCard;
            }
          });

        } catch (err) {
          console.error(err);
          setErrorMsg("Failed to parse Excel file.");
          return;
        }

      } else {
        // Text/CSV Processing
        let text = '';
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          text = decoder.decode(buffer);
        } catch (err) {
          try {
              const decoder = new TextDecoder('big5');
              text = decoder.decode(buffer);
          } catch (err2) {
              const decoder = new TextDecoder('utf-8');
              text = decoder.decode(buffer);
          }
        }

        const lines = text.split(/\r?\n/);

        lines.forEach((line, index) => {
          if (!line.trim()) return;
          if (index === 0 && (
              (line.toLowerCase().includes('class') && line.toLowerCase().includes('word')) ||
              (line.toLowerCase().includes('category') && line.toLowerCase().includes('front'))
          )) return;

          let cols = parseCSVLine(line);
          
          if (cols.length === 1 && lastCard) {
              const content = cols[0].trim();
              if (content.startsWith('【') || content.startsWith('-') || content.startsWith('(') || /^[A-Za-z]/.test(content)) {
                  lastCard.backOriginal += '\n' + content;
                  lastCard.parsed = parseBackContent(lastCard.backOriginal, lastCard.front);
                  return;
              }
          }

          let category = '';
          let front = '';
          let back = '';

          if (cols.length >= 3) {
            category = cols[0] ? cols[0].trim() : '';
            front = cols[1];
            back = cols.slice(2).join(', '); 
          } else if (cols.length === 2) {
            front = cols[0];
            back = cols[1];
            category = '';
          } else if (cols.length === 1) {
            front = cols[0];
            category = '';
          }

          const displayFront = front.trim();

          if (front) {
            const newCard = {
              id: `card-${index}`,
              category,
              front: displayFront || front, 
              backOriginal: back,
              parsed: parseBackContent(back, front)
            };
            cards.push(newCard);
            lastCard = newCard;
          }
        });
      }
      
      if (cards.length === 0) {
          setErrorMsg("No valid cards found in file.");
      } else {
          onUpload(cards);
      }
    };
    
    reader.onerror = () => setErrorMsg("Error reading file.");
    reader.readAsArrayBuffer(file);
  };

  return (
    <div 
      className={`h-full flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-3xl transition-all duration-300 ${dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'}`}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          processFile(e.dataTransfer.files[0]);
        }
      }}
    >
      <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 text-indigo-600">
        <Upload size={32} />
      </div>
      <h3 className="text-2xl font-bold text-slate-800 mb-2">Upload Flashcards</h3>
      <p className="text-slate-500 mb-8 text-center max-w-md">
        Upload your CSV or Excel (.xlsx) file.<br/>
        <span className="text-xs text-slate-400 mt-2 block">Format: Classification, Word, Definition (with 【中文】,【詞性變化】,【搭配詞】,【例句】)</span>
      </p>
      
      {errorMsg && (
          <div className="mb-6 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm">
              {errorMsg}
          </div>
      )}

      <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl cursor-pointer font-medium transition-colors shadow-lg shadow-indigo-200">
        Browse Files
        <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
      </label>
    </div>
  );
};

const Flashcard = ({ card, active, onNext, onPrev }: { card: ParsedCard, active: boolean, onNext: () => void, onPrev: () => void }) => {
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    setIsFlipped(false);
  }, [card]);

  // Extract Word and POS from front text
  const { frontWord, frontPos } = useMemo(() => {
    // Matches the word followed by POS in parentheses at the end. 
    // Example: "apple (n.)" -> word: "apple", pos: "(n.)"
    // Handles both half-width () and full-width （）
    const match = card.front.match(/^(.*?)(\s*[\(\[（].*?[\)\]）])$/);
    if (match) {
        return { frontWord: match[1].trim(), frontPos: match[2].trim() };
    }
    return { frontWord: card.front, frontPos: null };
  }, [card.front]);

  // Reusable audio player function using Google Translate TTS
  const playAudio = (text: string) => {
    // Basic cleanup for better TTS
    const cleanText = getEnglishTextOnly(text.replace(/[\(\[\{].*?[\)\]\}]/g, ''));
    if (!cleanText) return;

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(cleanText)}`;
    const audio = new Audio(url);

    audio.play().catch((err) => {
        console.warn("Google TTS failed, falling back to browser synthesis", err);
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel(); 
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
        }
    });
  };

  const handleFrontSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Speak only the word part, not the POS part
    playAudio(frontWord);
  };

  const handleTextSpeak = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    playAudio(text);
  };

  const renderSection = (section: CardSection, idx: number) => {
    // 1. Definition / 【中文】
    if (section.type === 'definition') {
        return (
            <div key={idx} className="mb-8 p-4 bg-white/5 rounded-2xl border border-white/10">
                {section.title && <div className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2 opacity-90 flex items-center gap-2">
                    <BookOpen size={14} />
                    {section.title}
                </div>}
                <div className="text-2xl md:text-3xl font-medium text-white leading-relaxed">
                    {section.content}
                </div>
            </div>
        );
    }

    // 2. Word Families / 【詞性變化】
    if (section.type === 'word_family') {
        const items = section.content.split(/[\n]+/).filter(s => s.trim());
        return (
            <div key={idx} className="mb-6">
                <div className="text-xs font-bold text-pink-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <RotateCcw size={14} /> {section.title || "Word Families"}
                </div>
                <div className="space-y-3">
                    {items.map((item, i) => {
                         const hasEnglish = /[a-zA-Z]/.test(item);
                         return (
                            <div key={i} className="flex items-start justify-between gap-4 p-3 rounded-xl bg-pink-500/10 border border-pink-500/20">
                                <span className="text-xl md:text-2xl text-pink-100 font-medium leading-relaxed">{item}</span>
                                {hasEnglish && (
                                    <button 
                                        onClick={(e) => handleTextSpeak(e, item)}
                                        className="shrink-0 p-2 rounded-full bg-pink-500/20 hover:bg-pink-500/40 text-pink-300 hover:text-white transition-colors"
                                        title="Play Variation"
                                        aria-label="Play Variation"
                                    >
                                        <Volume2 size={20} />
                                    </button>
                                )}
                            </div>
                         );
                    })}
                </div>
            </div>
        );
    }
    
    // 3. Collocations / 【搭配詞】
    if (section.type === 'collocation') {
        const items = section.content.split(/[\n,]+/).filter(s => s.trim());
        return (
            <div key={idx} className="mb-6">
                <div className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Layers size={14} /> {section.title || "Collocations"}
                </div>
                <div className="flex flex-wrap gap-3">
                    {items.map((item, i) => {
                        const cleanItem = item.replace(/^-/, '').trim();
                        // Check if it has English letters
                        const hasEnglish = /[a-zA-Z]/.test(cleanItem);

                        return (
                            <span key={i} className="px-5 py-3 rounded-xl bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 text-3xl font-medium leading-relaxed inline-flex items-center gap-3">
                                 <span>{cleanItem}</span>
                                 {hasEnglish && (
                                     <button 
                                       onClick={(e) => handleTextSpeak(e, cleanItem)}
                                       className="shrink-0 p-2 rounded-full bg-indigo-400/20 hover:bg-indigo-400/40 text-indigo-300 hover:text-white transition-colors"
                                       title="Play Collocation"
                                       aria-label="Play Collocation"
                                     >
                                         <Volume2 size={24} />
                                     </button>
                                 )}
                            </span>
                        );
                    })}
                </div>
            </div>
        );
    }

    // 4. Examples / 【例句】
    if (section.type === 'example') {
        const items = section.content.split('\n').filter(s => s.trim());
        return (
            <div key={idx} className="mb-6">
                 <div className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Quote size={14} /> {section.title || "Examples"}
                </div>
                <div className="space-y-4">
                    {items.map((item, i) => {
                        const hasEnglish = /[a-zA-Z]/.test(item);
                        
                        // Style: English/Mixed -> Large, Bold. Pure Chinese -> Smaller, Normal. No italics.
                        const textClasses = hasEnglish 
                            ? "text-3xl md:text-4xl text-slate-100 font-bold"
                            : "text-xl md:text-2xl text-slate-300 font-medium";

                        return (
                            <div key={i} className="pl-4 border-l-2 border-amber-500/50 py-1 group/ex">
                                <p className={`${textClasses} leading-relaxed flex items-start justify-between gap-4`}>
                                    <span>{item}</span>
                                    {hasEnglish && (
                                        <button 
                                          onClick={(e) => handleTextSpeak(e, item)}
                                          className="shrink-0 p-2 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-100 transition-colors"
                                          aria-label="Play Example"
                                        >
                                            <Volume2 size={18} />
                                        </button>
                                    )}
                                </p>
                            </div>
                        )
                    })}
                </div>
            </div>
        );
    }

    // Fallback
    return (
        <div key={idx} className="mb-6">
             {section.title && <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{section.title}</div>}
             <div className="text-xl text-slate-300 whitespace-pre-line">
                 {section.content}
             </div>
        </div>
    );
  };

  if (!card) return <div className="text-center text-slate-400">Select a card to begin</div>;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-5xl mx-auto h-full p-4 md:p-6">
      {/* 
         Fixed Layout Container with Relative Positioning
         We use `absolute inset-0` on children to ensure Front and Back match perfectly.
         Increased aspect ratio slightly for larger content area.
      */}
      <div 
        className="relative w-full aspect-[1.3/1] md:aspect-[1.5/1] cursor-pointer group perspective-1000"
        onClick={() => setIsFlipped(!isFlipped)}
      >
        <div className={`w-full h-full relative duration-500 transform-style-3d transition-all ${isFlipped ? 'rotate-y-180' : ''}`}>
          
          {/* FRONT - Absolute Inset 0 to lock position */}
          <div className="absolute inset-0 backface-hidden bg-slate-800 rounded-[2.5rem] shadow-2xl border border-slate-700 flex flex-col items-center justify-center p-8 md:p-16 overflow-hidden text-white z-20">
             {/* Background Decoration */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
            
            <div className="relative z-10 flex flex-col items-center text-center w-full">
              <div className="flex flex-col items-center gap-2 md:gap-4 w-full">
                {/* BIGGER TEXT - Word */}
                <h2 className="text-6xl md:text-8xl lg:text-9xl font-bold text-white tracking-tight break-words w-full leading-tight">
                    {frontWord}
                </h2>
                
                {/* POS - 0.5x size, Light Gray, Second Line */}
                {frontPos && (
                    <span className="text-3xl md:text-4xl lg:text-5xl text-slate-400 font-medium">
                        {frontPos}
                    </span>
                )}
                
                {/* Pronunciation Button */}
                <button 
                  onClick={handleFrontSpeak}
                  className="mt-4 md:mt-8 p-4 md:p-5 rounded-full bg-white/10 hover:bg-white/20 text-indigo-300 hover:text-white transition-all backdrop-blur-md border border-white/10 hover:border-white/30 hover:scale-110 active:scale-95 group"
                  title="Pronounce (Google Translate)"
                  aria-label="Play pronunciation"
                >
                  <Volume2 size={36} className="group-hover:animate-pulse" />
                </button>
              </div>
            </div>

            <div className="absolute bottom-8 text-slate-500 text-xs uppercase tracking-widest font-medium group-hover:text-indigo-400 transition-colors">
              Click to Flip
            </div>
          </div>

          {/* BACK - Absolute Inset 0 to lock position matches front exactly */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border border-slate-800 z-20">
             {/* Sticky Header */}
            <div className="shrink-0 px-8 py-6 border-b border-slate-800 bg-slate-900/95 backdrop-blur flex items-baseline gap-3">
                 <h3 className="text-3xl font-bold text-white truncate">{frontWord}</h3>
                 {frontPos && (
                    <span className="text-base text-slate-400 font-medium shrink-0">
                        {frontPos}
                    </span>
                 )}
            </div>
            
            {/* Scrollable Body - Scrollbar hidden visually */}
            <div className="flex-1 overflow-y-auto p-8 md:p-10 no-scrollbar">
                <style dangerouslySetInnerHTML={{__html: `
                  .no-scrollbar::-webkit-scrollbar { display: none; }
                  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
                `}} />
                
                {card.parsed.sections.length > 0 ? (
                    <div className="max-w-4xl mx-auto">
                        {card.parsed.sections.map((section, idx) => renderSection(section, idx))}
                    </div>
                ) : (
                    <div className="text-center text-slate-500 py-12 italic text-xl">
                        {card.backOriginal}
                    </div>
                )}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="flex items-center gap-8 mt-10">
        <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="p-4 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm hover:shadow-md group">
          <ChevronLeft className="w-6 h-6 group-hover:-translate-x-0.5 transition-transform" />
        </button>
        <span className="text-xs font-medium text-slate-400 uppercase tracking-[0.2em] select-none">
            {active ? 'Navigation' : 'Start'}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="p-4 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm hover:shadow-md group">
          <ChevronRight className="w-6 h-6 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </div>
  );
};

const App = () => {
  const [cards, setCards] = useState<ParsedCard[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Group cards by category
  const categories = useMemo(() => {
    const groups: Record<string, ParsedCard[]> = {};
    cards.forEach(card => {
      // If category is empty, we label it Uncategorized.
      const cat = card.category || 'Uncategorized'; 
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(card);
    });
    
    // Sort keys: "Uncategorized" last, others alphabetical
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === 'Uncategorized') return 1;
        if (b === 'Uncategorized') return -1;
        return a.localeCompare(b);
    });

    return sortedKeys.map(name => ({
      name,
      cards: groups[name]
    }));
  }, [cards]);

  // Filter based on search
  const filteredCategories = useMemo(() => {
    if (!searchTerm) return categories;
    
    return categories.map(cat => ({
      ...cat,
      cards: cat.cards.filter(c => 
        c.front.toLowerCase().includes(searchTerm.toLowerCase()) || 
        c.backOriginal.toLowerCase().includes(searchTerm.toLowerCase())
      )
    })).filter(cat => cat.cards.length > 0);
  }, [categories, searchTerm]);

  // Initial Expand logic
  useEffect(() => {
    if (searchTerm) {
      setExpandedCategories(new Set(categories.map(c => c.name)));
    } else if (categories.length > 0 && expandedCategories.size === 0) {
      // Expand only the first category by default
      const first = categories[0];
      if (first) {
        setExpandedCategories(new Set([first.name]));
      }
    }
  }, [categories, searchTerm]);

  const toggleCategory = (name: string) => {
    const newSet = new Set(expandedCategories);
    if (newSet.has(name)) newSet.delete(name);
    else newSet.add(name);
    setExpandedCategories(newSet);
  };

  const expandAll = () => setExpandedCategories(new Set(categories.map(c => c.name)));
  const collapseAll = () => setExpandedCategories(new Set());

  const handleNext = () => {
    const allFilteredCards = filteredCategories.flatMap(c => c.cards);
    if (!activeCardId && allFilteredCards.length > 0) {
        setActiveCardId(allFilteredCards[0].id);
        return;
    }
    const currentIndex = allFilteredCards.findIndex(c => c.id === activeCardId);
    if (currentIndex < allFilteredCards.length - 1) {
      setActiveCardId(allFilteredCards[currentIndex + 1].id);
    }
  };

  const handlePrev = () => {
    const allFilteredCards = filteredCategories.flatMap(c => c.cards);
    if (!activeCardId) return;
    const currentIndex = allFilteredCards.findIndex(c => c.id === activeCardId);
    if (currentIndex > 0) {
      setActiveCardId(allFilteredCards[currentIndex - 1].id);
    }
  };

  const activeCard = cards.find(c => c.id === activeCardId);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCardId, filteredCategories]);

  if (cards.length === 0) {
    return (
      <div className="w-full h-full bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl h-[600px] bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row">
            <div className="w-full md:w-1/3 bg-slate-900 p-8 flex flex-col justify-between text-white relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                    <div className="absolute top-10 right-10 w-64 h-64 bg-indigo-500 rounded-full blur-3xl"></div>
                    <div className="absolute bottom-10 left-10 w-64 h-64 bg-emerald-500 rounded-full blur-3xl"></div>
                </div>
                <div className="relative z-10">
                    <h1 className="text-4xl font-bold mb-6">Flashcard<br/>Master</h1>
                    <p className="text-slate-400 leading-relaxed">
                        Effortlessly transform your CSV vocabulary lists into elegant, interactive study tools.
                    </p>
                    <div className="mt-8 space-y-4 text-sm text-slate-400">
                         <div className="flex items-start gap-3">
                           <div className="bg-slate-800 p-1.5 rounded text-indigo-400 mt-0.5"><Folder size={14} /></div>
                           <div>
                               <strong className="text-white block">Column 1: Classification</strong>
                               Category groups (Expandable)
                           </div>
                        </div>
                        <div className="flex items-start gap-3">
                           <div className="bg-slate-800 p-1.5 rounded text-emerald-400 mt-0.5"><Layers size={14} /></div>
                           <div>
                               <strong className="text-white block">Column 3: Back Content</strong>
                               Auto-parses 【中文】, 【詞性變化】, 【搭配詞】, 【例句】
                           </div>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2 text-sm text-slate-500 relative z-10">
                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                    <div className="w-2 h-2 rounded-full bg-pink-500"></div>
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                </div>
            </div>
            <div className="w-full md:w-2/3 p-4">
                <FileUploader onUpload={(data) => {
                    setCards(data);
                    if (data.length > 0) setActiveCardId(data[0].id);
                }} />
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-slate-100 overflow-hidden relative">
      
      {/* Mobile Toggle */}
      <button 
        className="md:hidden absolute top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md hover:bg-slate-50 text-slate-700"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20}/> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <div className={`
        ${sidebarOpen ? 'translate-x-0 w-[420px]' : '-translate-x-full w-0'} 
        transition-all duration-300 ease-in-out
        bg-white h-full border-r border-slate-200 flex flex-col z-40 absolute md:relative shadow-2xl md:shadow-none font-sans
      `}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="font-bold text-xl text-slate-800 flex items-center gap-2">
              <BookOpen size={20} className="text-indigo-600"/>
              Vocabulary
            </h1>
            <div className="flex items-center gap-1">
               <button onClick={collapseAll} title="Collapse All" className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"><Minus size={16} /></button>
               <button onClick={expandAll} title="Expand All" className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"><Plus size={16} /></button>
               <div className="w-px h-4 bg-slate-200 mx-1"></div>
               <button 
                onClick={() => setCards([])} 
                title="Upload New"
                className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-md transition-all"
               >
                 <RotateCcw size={16} />
               </button>
            </div>
          </div>
          
          <div className="relative group">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search words..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>
        
        {/* Categories List */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-1">
            {filteredCategories.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm">No words found.</div>
            )}

            {filteredCategories.map((cat) => {
              // Enhanced parsing: Split English (line 1) and Chinese (line 2)
              // Supports explicit newline OR auto-split before first Chinese character OR "English (Chinese)" pattern
              let mainTitle = cat.name;
              let subTitle = '';

              // Priority 1: Check for "English (Chinese)" pattern
              const parensMatch = cat.name.match(/^(.*?)\s*[（(](.*)[)）]$/); 

              if (parensMatch) {
                  mainTitle = parensMatch[1].trim();
                  subTitle = parensMatch[2].trim();
              } 
              // Priority 2: Check for explicit newline
              else if (cat.name.match(/\r?\n/)) {
                  const parts = cat.name.split(/\r?\n/);
                  mainTitle = parts[0].trim();
                  subTitle = parts.slice(1).join(' ').trim();
              } 
              // Priority 3: Fallback auto-detection of Chinese char start
              else {
                  const cIndex = cat.name.search(/[\u4e00-\u9fa5]/);
                  if (cIndex > 0) {
                      mainTitle = cat.name.substring(0, cIndex).trim();
                      subTitle = cat.name.substring(cIndex).trim();
                  }
              }

              return (
                <div key={cat.name} className="mb-1">
                  <button 
                    onClick={() => toggleCategory(cat.name)}
                    className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-slate-100 transition-all duration-200 group text-left select-none"
                  >
                    <div className={`
                      w-8 h-8 flex items-center justify-center rounded-lg border-2 transition-colors shrink-0
                      ${expandedCategories.has(cat.name) 
                        ? 'bg-white border-slate-300 text-slate-600 shadow-sm' 
                        : 'bg-indigo-50 border-indigo-100 text-indigo-600'}
                    `}>
                       {expandedCategories.has(cat.name) ? <Minus size={18} strokeWidth={3} /> : <Plus size={18} strokeWidth={3} />}
                    </div>
                    
                    <div className="flex-1 flex flex-col justify-center overflow-hidden text-left">
                      <span className={`font-bold text-lg leading-snug truncate transition-colors ${expandedCategories.has(cat.name) ? 'text-indigo-900' : 'text-slate-700'}`}>
                          {mainTitle}
                      </span>
                      {subTitle && (
                          <span className={`text-xs font-medium truncate ${expandedCategories.has(cat.name) ? 'text-indigo-500' : 'text-slate-400'}`}>
                              {subTitle}
                          </span>
                      )}
                    </div>
                    
                    <span className="text-sm font-bold text-slate-400 px-3 py-1 bg-slate-100 rounded-full border border-slate-200 shrink-0">
                      {cat.cards.length}
                    </span>
                  </button>
                  
                  {expandedCategories.has(cat.name) && (
                    <div className="ml-4 pl-3 border-l-4 border-slate-100 mt-1 mb-2 space-y-1 animate-in slide-in-from-left-1 duration-200 fade-in-0">
                      {cat.cards.map(card => (
                        <button
                          key={card.id}
                          onClick={() => { setActiveCardId(card.id); if (window.innerWidth < 768) setSidebarOpen(false); }}
                          className={`
                            w-full text-left pl-6 pr-4 py-3 text-xl rounded-r-lg transition-all duration-200 
                            flex items-center gap-3 border-l-4 -ml-[2px]
                            ${activeCardId === card.id 
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold' 
                              : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'}
                          `}
                        >
                           <span className="truncate">{card.front}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        
        {/* Footer */}
        <div className="p-3 border-t border-slate-100 text-center bg-slate-50">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium">
                {filteredCategories.reduce((acc, cat) => acc + cat.cards.length, 0)} Words Loaded
            </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 h-full relative flex flex-col bg-slate-100/50">
        {activeCard ? (
          <Flashcard 
            card={activeCard} 
            active={true} 
            onNext={handleNext}
            onPrev={handlePrev}
          />
        ) : (
           <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-4">
             <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-2">
                 <CornerDownRight size={32} className="text-indigo-200" />
             </div>
             <p className="text-lg text-slate-500 font-bold">Select a word from the sidebar</p>
           </div>
        )}
      </div>

    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
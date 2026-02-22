import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import gsap from 'gsap';
import { ChevronLeft, ChevronRight, ArrowRight, Video, Scissors, Search, Sparkles, MousePointer2 } from 'lucide-react';

const TitleSlide = ({ onNext, isActive, isDarkMode }: { onNext: () => void, isActive: boolean, isDarkMode: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.hero-anim',
        { y: 80, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.2, stagger: 0.15, ease: 'power3.out', delay: 0.2 }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [isActive]);

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-center p-12 relative">
      <div className={`absolute top-12 left-1/2 -translate-x-1/2 font-sans font-semibold tracking-[0.2em] text-sm uppercase hero-anim transition-colors duration-700 ${isDarkMode ? 'text-white/50' : 'text-[#111827]/50'}`} />
      <div className="text-center max-w-6xl w-full flex flex-col items-center">
        <h1 className={`font-heading font-black uppercase text-[15vw] leading-[0.85] tracking-[-0.04em] hero-anim mt-4 transition-colors duration-700 ${isDarkMode ? 'text-white' : 'text-[#111827]'}`}>
          VIDERE
        </h1>
        <h2 className={`font-drama italic text-[4.5vw] leading-none mt-6 hero-anim font-light transition-colors duration-700 ${isDarkMode ? 'text-white/80' : 'text-[#111827]/80'}`}>
          Edit with perfect recall.
        </h2>

        <p className={`mt-12 text-base md:text-lg max-w-2xl text-center hero-anim font-medium font-sans leading-relaxed tracking-wide text-balance transition-colors duration-700 ${isDarkMode ? 'text-white/70' : 'text-[#111827]/70'}`}>
          Multipurpose local AI-powered video editor. Experience seamless transcription, semantic scene search, and auto B-Roll embedding matching in a single tranquil workspace.
        </p>

        <button
          onClick={onNext}
          className={`mt-16 flex items-center gap-3 px-8 py-4 rounded-full font-heading font-bold tracking-wide text-lg btn-magnetic hover-lift hero-anim transition-colors duration-700 ${isDarkMode ? 'bg-white text-[#111827]' : 'bg-[#93C5FD] text-white'}`}
        >
          <span>Begin Experience</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      <div className={`absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl mix-blend-overlay -z-10 animate-pulse transition-colors duration-700 ${isDarkMode ? 'bg-blue-500/20' : 'bg-white/40'}`} />
      <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl mix-blend-overlay -z-10 animate-pulse transition-colors duration-700 ${isDarkMode ? 'bg-indigo-500/20' : 'bg-[#93C5FD]/20'}`} style={{ animationDelay: '1s' }} />
    </div>
  );
};

const DiagnosticShuffler = ({ isActive, isDarkMode }: { isActive: boolean, isDarkMode: boolean }) => {
  // Array shifting every 3 seconds for Scene Context feature
  const [items, setItems] = useState([
    { id: 1, text: "\"so I landed the backflip\"", bg: isDarkMode ? "bg-white/10 text-white" : "bg-[#FFFFFF] text-[#111827]" },
    { id: 2, text: "[SILENCE DETECTED: 2.1s]", bg: isDarkMode ? "bg-white/5 text-white/80" : "bg-[#FFFFFF]/80 text-[#111827]/80" },
    { id: 3, text: "\"wait, let me try that again\"", bg: isDarkMode ? "bg-white/5 text-white/50" : "bg-[#FFFFFF]/50 text-[#111827]/50" }
  ]);

  useEffect(() => {
    // Update items bg colors when dark mode changes
    setItems(prev => prev.map(item => {
      let bg = item.bg;
      if (item.id === 1) bg = isDarkMode ? "bg-white/10 text-white border-white/20" : "bg-[#FFFFFF] text-[#111827] border-[#111827]/10";
      if (item.id === 2) bg = isDarkMode ? "bg-white/5 text-white/80 border-white/10" : "bg-[#FFFFFF]/80 text-[#111827]/80 border-[#111827]/10";
      if (item.id === 3) bg = isDarkMode ? "bg-transparent text-white/50 border-white/5" : "bg-[#FFFFFF]/50 text-[#111827]/50 border-[#111827]/10";
      return { ...item, bg };
    }));
  }, [isDarkMode]);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setItems(prev => {
        const newArr = [...prev];
        const last = newArr.pop()!;
        newArr.unshift(last);
        return newArr;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className={`rounded-[2rem] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.04)] border flex flex-col items-center relative overflow-hidden h-full transition-colors duration-700 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-[#FFFFFF]/50 border-white/60'}`}>
      <div className="mb-8 w-full">
        <h3 className={`font-heading font-bold text-xl transition-colors duration-700 ${isDarkMode ? 'text-white' : 'text-[#111827]'}`}>Transcript Editor</h3>
        <p className={`font-sans text-sm mt-1 transition-colors duration-700 ${isDarkMode ? 'text-white/60' : 'text-[#111827]/60'}`}>Time-Aware Cut Detection</p>
      </div>

      <div className="relative w-full flex-1 flex items-center justify-center">
        {items.map((item, index) => {
          const isTop = index === 0;
          const isMid = index === 1;

          return (
            <div
              key={item.id}
              className={`absolute w-full p-4 rounded-xl border flex items-center gap-4 transition-all duration-[800ms] ${item.bg}`}
              style={{
                top: isTop ? '15%' : isMid ? '35%' : '55%',
                transform: `scale(${isTop ? 1 : isMid ? 0.95 : 0.9})`,
                zIndex: isTop ? 30 : isMid ? 20 : 10,
                opacity: isTop ? 1 : isMid ? 0.7 : 0.4,
                boxShadow: isTop ? '0 10px 25px -5px rgba(0,0,0,0.1)' : 'none',
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
              }}
            >
              <div className="w-8 h-8 rounded-full bg-[#93C5FD]/20 flex items-center justify-center shrink-0">
                <Scissors className="w-4 h-4 text-[#93C5FD]" />
              </div>
              <span className="font-sans font-medium truncate">{item.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const TelemetryTypewriter = ({ isActive, isDarkMode }: { isActive: boolean, isDarkMode: boolean }) => {
  const fullText = "> Querying scene context...\n> Target: \"successfully did a backflip\"\n> Scanning visual frames...\n> 3 matches found in source\n> Filtering out failed attempts...\n> Clip 1: [02:14 - 02:18] Extracted.";
  const [displayText, setDisplayText] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isActive) {
      const reset = setTimeout(() => {
        setDisplayText('');
        setIndex(0);
      }, 0);
      return () => clearTimeout(reset);
    }

    if (index < fullText.length) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev + fullText.charAt(index));
        setIndex(i => i + 1);
      }, Math.random() * 30 + 20); // variable typing speed
      return () => clearTimeout(timeout);
    }
  }, [isActive, index]);

  return (
    <div className={`rounded-[2rem] p-8 shadow-xl flex flex-col h-full overflow-hidden transition-colors duration-700 ${isDarkMode ? 'bg-[#0a0f1d] text-white border border-white/10' : 'bg-[#111827] text-[#FFFFFF]'}`}>
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-heading font-bold text-xl">Scene Context Feed</h3>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#93C5FD] animate-pulse" />
          <span className={`font-data text-xs uppercase tracking-wider transition-colors duration-700 ${isDarkMode ? 'text-white/50' : 'text-[#FFFFFF]/50'}`}>Semantic Search</span>
        </div>
      </div>

      <p className={`font-sans text-sm mb-8 border-b pb-4 transition-colors duration-700 ${isDarkMode ? 'text-white/60 border-white/10' : 'text-[#FFFFFF]/60 border-[#FFFFFF]/10'}`}>
        Extracting clips based on visual actions
      </p>

      <div className="font-data text-sm leading-relaxed text-[#93C5FD]/90 whitespace-pre-wrap flex-1">
        {displayText.split('\n').map((line, i) => (
          <div key={i} className="mb-2">{line}</div>
        ))}
        {index < fullText.length && <span className="inline-block w-2 h-4 bg-[#FFFFFF] animate-pulse ml-1" />}
      </div>
    </div>
  );
};

const CursorProtocolScheduler = ({ isActive, isDarkMode }: { isActive: boolean, isDarkMode: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const tk = gsap.context(() => {
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.5 });

      gsap.set('.sim-cursor', { opacity: 0, left: '95%', top: '90%' });
      gsap.set('.drag-clip', { opacity: 0, scale: 1 });
      gsap.set('.timeline-gap', { width: 0, margin: 0 });
      gsap.set('.timeline-inserted-clip', { opacity: 0, scale: 0.8 });
      gsap.set('.pool-clip-item', { opacity: 0.5, scale: 1, filter: 'brightness(1)' });

      // Scan Sequence: Indices format "row-col" inside the media pool
      const scanSequence = [0, 1, 4, 5, 2];

      tl.to('.sim-cursor', { opacity: 1, duration: 0.3 });

      // Scan through intermediate clips
      scanSequence.slice(0, 4).forEach((index, i) => {
        const col = index % 2;
        const row = Math.floor(index / 2);

        // Approximate coordinates in the media pool area
        const scanX = 84 + (col * 8);
        const scanY = 18 + (row * 14);

        tl.to('.sim-cursor', { left: `${scanX}%`, top: `${scanY}%`, duration: 0.3, ease: 'power2.inOut' })
          .to(`.pool-clip-${index}`, { opacity: 1, scale: 1.05, filter: 'brightness(1.5)', duration: 0.1 }, '<')
          .to(`.pool-clip-${index}`, { opacity: 0.5, scale: 1, filter: 'brightness(1)', duration: 0.2 }, '+=0.1');
      });

      // Navigate to final target (Clip 2)
      tl.to('.sim-cursor', { left: '84%', top: '32%', duration: 0.3, ease: 'power2.inOut' })
        .to(`.pool-clip-2`, { opacity: 1, scale: 1.05, filter: 'brightness(1.5)', duration: 0.1 }, '<')
        .to('.sim-cursor', { scale: 0.85, duration: 0.1 })

        // Grab clip
        .set('.drag-clip', { opacity: 1, left: '84%', top: '32%' })
        .to('.pool-clip-2', { opacity: 0.2, scale: 1, filter: 'brightness(1)', duration: 0.1 }, '<')

        // Drag to timeline
        .to(['.sim-cursor', '.drag-clip'], { left: '46%', top: '75%', duration: 0.8, ease: 'power2.inOut' })
        .to('.timeline-gap', { width: 100, marginLeft: 4, marginRight: 4, duration: 0.4, ease: 'power3.out' }, '-=0.3')

        // Drop clip
        .to('.sim-cursor', { scale: 1, duration: 0.1 })
        .to('.drag-clip', { opacity: 0, duration: 0.1 })
        .to('.timeline-inserted-clip', { opacity: 1, scale: 1, duration: 0.2 }, '<')

        // Move cursor away
        .to('.sim-cursor', { left: '30%', top: '85%', opacity: 0, duration: 0.6, ease: 'power2.inOut' })

        // Reset everything
        .to('.pool-clip-2', { opacity: 0.5, duration: 0.2 }, '+=1')
        .to('.timeline-inserted-clip', { opacity: 0, scale: 0.8, duration: 0.2 }, '<')
        .to('.timeline-gap', { width: 0, marginLeft: 0, marginRight: 0, duration: 0.3, ease: 'power2.inOut' });

    }, containerRef);

    return () => tk.revert();
  }, [isActive]);

  return (
    <div ref={containerRef} className={`rounded-[2rem] p-8 md:p-12 shadow-[0_8px_32px_rgba(0,0,0,0.04)] border flex flex-col relative h-full w-full transition-colors duration-700 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-[#FFFFFF]/50 border-white/60'}`}>
      <div className="mb-6 w-full text-center">
        <h3 className={`font-heading font-bold text-3xl transition-colors duration-700 ${isDarkMode ? 'text-white' : 'text-[#111827]'}`}>B-Roll Auto-Retrieval</h3>
        <p className={`font-sans text-lg mt-2 transition-colors duration-700 ${isDarkMode ? 'text-white/60' : 'text-[#111827]/60'}`}>Smart Contextual Asset Placement</p>
      </div>

      {/* Editor Mockup */}
      <div className="flex-1 rounded-2xl overflow-hidden flex border border-[#333]/30 bg-[#1c1c1c] relative shadow-inner select-none mt-4 w-full self-center min-h-[300px]">

        {/* Left Side: Track Headers */}
        <div className="w-[120px] bg-[#2a2a2a] border-r border-[#111] flex flex-col justify-end pb-[16px] z-10 shrink-0">
          <div className="h-16 flex items-center px-4 mb-[4px] gap-2 opacity-80">
            <svg className="w-5 h-5 text-white shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4" /></svg>
            <span className="text-xs font-sans text-white font-medium tracking-wide truncate">Video 1</span>
          </div>
          <div className="h-16 flex items-center px-4 gap-2 opacity-80">
            <svg className="w-5 h-5 text-white shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
            <span className="text-xs font-sans text-white font-medium tracking-wide truncate">Audio</span>
          </div>
        </div>

        {/* Middle: Timeline Tracks */}
        <div className="flex-1 flex flex-col justify-end pb-[16px] relative overflow-hidden bg-[#1c1c1c] border-r border-[#111]">
          {/* Timeline Grid Lines */}
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '60px 100%' }} />

          {/* Video Track */}
          <div className="h-16 mb-[4px] w-[150%] bg-[#36639c] rounded-r flex items-center px-[4px] overflow-hidden">
            {/* Clips */}
            <div className="h-[80%] w-24 bg-black/40 rounded mx-[2px] relative overflow-hidden border border-white/10 shadow-sm shrink-0">
              <div className="absolute top-0 bottom-0 right-0 bg-white/5 w-1/3" />
            </div>
            <div className="h-[80%] w-16 bg-black/40 rounded mx-[2px] relative overflow-hidden border border-white/10 shadow-sm shrink-0" />
            <div className="h-[80%] w-32 bg-black/40 rounded mx-[2px] relative overflow-hidden border border-white/10 shadow-sm shrink-0">
              <div className="absolute top-0 bottom-0 left-0 bg-white/5 w-1/2" />
            </div>

            {/* Gap for dragged clip */}
            <div className="timeline-gap h-[80%] flex-shrink-0 flex items-center justify-center relative overflow-hidden box-border">
              <div className="timeline-inserted-clip w-full h-full bg-black/40 rounded border border-white/40 shadow-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#5282c1] to-[#7aa5e0] opacity-40" />
                <div className="absolute top-0 left-0 right-0 h-1/3 bg-white/20" />
              </div>
            </div>

            <div className="h-[80%] w-36 bg-black/40 rounded mx-[2px] relative overflow-hidden border border-white/10 shadow-sm shrink-0" />
            <div className="h-[80%] w-20 bg-black/40 rounded mx-[2px] relative overflow-hidden border border-white/10 shadow-sm shrink-0" />
          </div>

          {/* Audio Track */}
          <div className="h-16 w-[150%] bg-[#3d8c54] rounded-r flex items-center overflow-hidden relative border-t border-black/20">
            <svg className="absolute w-[400px] h-full opacity-60 mix-blend-screen" preserveAspectRatio="none" viewBox="0 0 200 24">
              <path d="M0,12 Q5,10 10,12 T20,12 T30,12 T40,6 T50,12 T60,12 T70,16 T80,12 T90,12 T100,12 T110,8 T120,12 T130,12 T140,15 T150,12 T160,12 T170,12 T180,12 T190,12 T200,12" fill="none" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* Right Side: Media Pool */}
        <div className="w-[180px] bg-[#222] shrink-0 p-3 grid grid-cols-2 gap-2 auto-rows-[55px] overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-[#222] to-transparent z-10 pointer-events-none" />
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={`pool-clip-item pool-clip-${i} rounded-[2px] overflow-hidden bg-[#333] relative border border-white/5`}>
              <div className={`absolute inset-0 bg-gradient-to-br ${i % 3 === 0 ? 'from-[#4a5568] to-[#2d3748]' : i % 3 === 1 ? 'from-[#a0aec0] to-[#718096]' : 'from-[#718096] to-[#4a5568]'}`} />
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50" />
            </div>
          ))}
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[#222] to-transparent z-10 pointer-events-none" />
        </div>

        {/* Dragged Clip Ghost */}
        <div className="drag-clip absolute w-[80px] h-[55px] rounded pointer-events-none z-30 flex items-center justify-center overflow-hidden border border-white/50 shadow-xl" style={{ opacity: 0, transform: 'translate(-50%, -50%)' }}>
          <div className="absolute inset-0 bg-gradient-to-br from-[#718096] to-[#4a5568] opacity-100" />
          <div className="absolute bottom-0 left-0 right-0 h-2 bg-black/50" />
        </div>

        {/* Simulated Cursor */}
        <div className="sim-cursor absolute pointer-events-none z-40" style={{ transform: 'translate(-3px, -3px)' }}>
          <MousePointer2 className="w-8 h-8 fill-white text-black stroke-[1.5px] drop-shadow-md" />
        </div>
      </div>
    </div>
  );
};

const TerminalPoint = ({ isActive, isDarkMode }: { isActive: boolean, isDarkMode: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.cta-anim',
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.2, stagger: 0.1, ease: 'power3.out', delay: 0.2 }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [isActive]);

  const onLaunch = () => {
    navigate('/projects');
  };

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-center relative p-12">
      <div className="text-center flex flex-col items-center max-w-4xl z-10">
        <h2 className={`font-heading font-black text-[6vw] leading-[0.9] tracking-tight uppercase cta-anim transition-colors duration-700 ${isDarkMode ? 'text-white' : 'text-[#111827]'}`}>
          The Future
        </h2>
        <h3 className={`font-drama italic text-[5vw] leading-none mt-4 cta-anim transition-colors duration-700 ${isDarkMode ? 'text-white/90' : 'text-[#111827]/90'}`}>
          is localized.
        </h3>

        <button
          onClick={onLaunch}
          className={`mt-24 group relative overflow-hidden px-16 py-6 rounded-[3rem] font-heading font-bold text-3xl tracking-wide btn-magnetic scale-110 cta-anim shadow-2xl transition-colors duration-700 ${isDarkMode ? 'bg-white text-[#111827]' : 'bg-[#111827] text-[#FFFFFF]'}`}>
          <span className="relative z-10 flex items-center gap-4">
            Launch the app
            <Sparkles className="w-8 h-8 group-hover:rotate-12 transition-transform" />
          </span>
          <div className="absolute inset-0 bg-[#93C5FD] translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out z-0" />
        </button>
      </div>

      <div className={`absolute bottom-8 w-full px-12 flex justify-between items-center text-sm font-data cta-anim transition-colors duration-700 ${isDarkMode ? 'text-white/50' : 'text-[#111827]/50'}`}>
        <span />
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span />
        </div>
        <div className="flex gap-6">
          <a href="#" className={`transition-colors duration-300 ${isDarkMode ? 'hover:text-white' : 'hover:text-[#111827]'}`}>Documentation</a>
          <a href="#" className={`transition-colors duration-300 ${isDarkMode ? 'hover:text-white' : 'hover:text-[#111827]'}`}>Privacy</a>
        </div>
      </div>
    </div>
  );
};

export default function IndexRoute() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const nextSlide = () => {
    if (activeIndex < 4) setActiveIndex(i => i + 1);
  };

  const prevSlide = () => {
    if (activeIndex > 0) setActiveIndex(i => i - 1);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const xPos = -(activeIndex * window.innerWidth);

    gsap.to(containerRef.current, {
      x: xPos,
      ease: 'power3.inOut',
      duration: 1.2,
      overwrite: 'auto'
    });
  }, [activeIndex]);

  return (
    <div className={`relative w-screen h-[100dvh] overflow-hidden transition-colors duration-1000 ${isDarkMode ? 'bg-[#0a0f1d]' : 'bg-[#DCEFFA] hover:bg-gradient-to-br hover:from-[#DCEFFA] hover:to-[#C1E3F5]'}`}>

      {/* Global Fine Grain Background Layer */}
      <div className={`absolute inset-0 z-0 pointer-events-none transition-opacity duration-1000 mix-blend-overlay ${isDarkMode ? 'opacity-30' : 'opacity-40'}`} style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='3' stitchTiles='stitch' /%3E%3CfeColorMatrix type='matrix' values='1 0 0 0 0, 1 0 0 0 0, 1 0 0 0 0, 0 0 0 6 -2' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' /%3E%3C/svg%3E")` }} />

      {/* Slide container - rendered FIRST so buttons layer on top */}
      <div className="flex w-[500vw] h-full relative z-10" ref={containerRef}>
        <div className="w-screen h-full shrink-0 flex items-center justify-center">
          <TitleSlide isActive={activeIndex === 0} onNext={nextSlide} isDarkMode={isDarkMode} />
        </div>

        {/* Engine Room Slide 1: Diagnostic Shuffler */}
        <div className="w-screen h-full shrink-0 flex items-center justify-center p-8 md:p-16 relative">
          <div className={`w-full max-w-5xl h-full max-h-[800px] rounded-[3rem] shadow-2xl flex flex-col p-10 md:p-16 relative overflow-hidden transition-all duration-700 ease-in-out border
            ${isDarkMode
              ? 'bg-[#0f172a]/80 backdrop-blur-2xl border-white/10 text-white'
              : 'bg-[#FFFFFF]/40 backdrop-blur-2xl border-white/50 text-[#111827]'
            }
          `}>
            <div className={`absolute inset-0 bg-gradient-to-br from-transparent ${isDarkMode ? 'to-blue-900/10' : 'to-[#C1E3F5]/20'} pointer-events-none`} />
            <div className="flex justify-between items-start mb-2 relative z-10">
              <h2 className="font-heading font-black text-4xl tracking-tight uppercase">Intelligent parsing protocols actively engaged</h2>
            </div>
            <p className={`font-drama italic text-2xl mb-12 transition-colors duration-700 ${isDarkMode ? 'text-white/60' : 'text-[#111827]/60'}`} />

            <div className="flex-1 w-full max-w-[420px] mx-auto relative z-10 h-full">
              <DiagnosticShuffler isActive={activeIndex === 1} isDarkMode={isDarkMode} />
            </div>
          </div>
        </div>

        {/* Engine Room Slide 2: Telemetry Typewriter */}
        <div className="w-screen h-full shrink-0 flex items-center justify-center p-8 md:p-16 relative">
          <div className={`w-full max-w-5xl h-full max-h-[800px] rounded-[3rem] shadow-2xl flex flex-col p-10 md:p-16 relative overflow-hidden transition-all duration-700 ease-in-out border
            ${isDarkMode
              ? 'bg-[#0f172a]/80 backdrop-blur-2xl border-white/10 text-white'
              : 'bg-[#FFFFFF]/40 backdrop-blur-2xl border-white/50 text-[#111827]'
            }
          `}>
            <div className={`absolute inset-0 bg-gradient-to-br from-transparent ${isDarkMode ? 'to-blue-900/10' : 'to-[#C1E3F5]/20'} pointer-events-none`} />
            <div className="flex justify-between items-start mb-2 relative z-10">
              <h2 className="font-heading font-black text-4xl tracking-tight uppercase">Semantic Scene Scanning</h2>
            </div>
            <p className={`font-drama italic text-2xl mb-12 transition-colors duration-700 ${isDarkMode ? 'text-white/60' : 'text-[#111827]/60'}`} />

            <div className="flex-1 w-full max-w-[420px] mx-auto relative z-10 h-full">
              <TelemetryTypewriter isActive={activeIndex === 2} isDarkMode={isDarkMode} />
            </div>
          </div>
        </div>

        {/* Engine Room Slide 3: Cursor Protocol Scheduler */}
        <div className="w-screen h-full shrink-0 flex items-center justify-center p-8 md:p-16 relative">
          <div className={`w-full max-w-5xl h-full max-h-[800px] rounded-[3rem] shadow-2xl flex flex-col p-10 md:p-16 relative overflow-hidden transition-all duration-700 ease-in-out border
            ${isDarkMode
              ? 'bg-[#0f172a]/80 backdrop-blur-2xl border-white/10 text-white'
              : 'bg-[#FFFFFF]/40 backdrop-blur-2xl border-white/50 text-[#111827]'
            }
          `}>
            <div className={`absolute inset-0 bg-gradient-to-br from-transparent ${isDarkMode ? 'to-blue-900/10' : 'to-[#C1E3F5]/20'} pointer-events-none`} />
            <div className="flex justify-between items-start mb-2 relative z-10">
              <h2 className="font-heading font-black text-4xl tracking-tight uppercase">B-Roll Auto-Retrieval Sequence</h2>
            </div>
            <p className={`font-drama italic text-2xl mb-12 transition-colors duration-700 ${isDarkMode ? 'text-white/60' : 'text-[#111827]/60'}`} />

            <div className="flex-1 w-full max-w-4xl mx-auto relative z-10 h-full">
              <CursorProtocolScheduler isActive={activeIndex === 3} isDarkMode={isDarkMode} />
            </div>
          </div>
        </div>

        <div className="w-screen h-full shrink-0 flex items-center justify-center">
          <TerminalPoint isActive={activeIndex === 4} isDarkMode={isDarkMode} />
        </div>
      </div>

      {/* Dark Mode Button - rendered AFTER slides so it layers on top */}
      <div className="absolute top-8 right-12 z-50">
        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all duration-300 border
                  ${isDarkMode ? 'bg-white/10 border-white/20 text-white hover:bg-white/20' : 'bg-black/5 border-black/10 text-black hover:bg-black/10'}
              `}
        >
          <div className={`w-2 h-2 rounded-full transition-colors ${isDarkMode ? 'bg-blue-400' : 'bg-black/60'}`} />
          {isDarkMode ? 'LIGHT MODE' : 'DARK MODE'}
        </button>
      </div>

      {/* Navigation arrows - rendered AFTER slides so they layer on top */}
      {activeIndex > 0 && (
        <button
          onClick={prevSlide}
          className={`absolute left-6 md:left-12 top-1/2 -translate-y-1/2 z-50 w-16 h-16 rounded-full backdrop-blur-2xl flex items-center justify-center transition-all duration-300 hover:scale-105 shadow-[0_8px_32px_rgba(0,0,0,0.08)] group border
            ${isDarkMode ? 'bg-white/10 border-white/20 text-white hover:bg-white/20' : 'bg-white/40 border-white/50 text-[#111827] hover:bg-white/60'}
          `}
        >
          <ChevronLeft className="w-8 h-8 stroke-[1.5] group-hover:-translate-x-0.5 transition-transform" />
        </button>
      )}

      {activeIndex < 4 && (
        <button
          onClick={nextSlide}
          className={`absolute right-6 md:right-12 top-1/2 -translate-y-1/2 z-50 w-16 h-16 rounded-full backdrop-blur-2xl flex items-center justify-center transition-all duration-300 hover:scale-105 shadow-[0_8px_32px_rgba(0,0,0,0.08)] group border
            ${isDarkMode ? 'bg-white/10 border-white/20 text-white hover:bg-white/20' : 'bg-white/40 border-white/50 text-[#111827] hover:bg-white/60'}
          `}
        >
          <ChevronRight className="w-8 h-8 stroke-[1.5] group-hover:translate-x-0.5 transition-transform" />
        </button>
      )}
    </div>
  );
}

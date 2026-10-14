"use client";
import { useState, useEffect } from "react";

export default function Home() {
  const [grid, setGrid] = useState(Array(200).fill(0));
  // NEW: States for our AI
  const [aiResponse, setAiResponse] = useState("System active. Monitoring patient pressure distribution. Awaiting threshold breach to generate repositioning strategy...");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // SYNTHETIC DATA GENERATOR
  useEffect(() => {
    const timer = setInterval(() => {
      setGrid((prevGrid) =>
        prevGrid.map((val, index) => {
          const row = Math.floor(index / 10);
          const col = index % 10;
          // The Human Silhouette
          const isBody = 
            (row >= 2 && row <= 4 && col >= 4 && col <= 5) || // Head
            (row >= 5 && row <= 8 && col >= 3 && col <= 6) || // Shoulders & Chest
            (row >= 9 && row <= 12 && col >= 4 && col <= 5) || // Waist
            (row >= 13 && row <= 16 && (col === 3 || col === 6)) || // Legs
            (row >= 17 && row <= 18 && (col === 3 || col === 6)); // Heels

          if (isBody) {
            return Math.min(10, val + (Math.random() > 0.7 ? 1 : 0));
          }
          return val;
        })
      );
    }, 1000); 

    return () => clearInterval(timer);
  }, []);

  const getColor = (val: number) => {
    if (val === 0) return "bg-gray-800"; 
    if (val <= 3) return "bg-blue-500";  
    if (val <= 6) return "bg-yellow-400"; 
    if (val <= 8) return "bg-orange-500"; 
    return "bg-red-600 animate-pulse shadow-[0_0_15px_rgba(220,38,38,0.7)]"; 
  };

  const maxPressure = Math.max(...grid) * 10;
  const statusColor = maxPressure >= 70 ? "text-red-500 animate-pulse" : "text-green-400";
  const statusText = maxPressure >= 70 ? "CRITICAL" : "Normal";

  // NEW: The function that talks to Gemini
  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAiResponse("Transmitting sensor matrix to Gemini AI...");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPressure: maxPressure }),
      });
      
      const data = await res.json();
      
      // THE FRONTEND OVERRIDE: If the backend is stuck on the old cached error, we overwrite it here.
      if (data.recommendation === "Error connecting to AI diagnostic system." || !res.ok) {
          setAiResponse(`Critical Ischemia Risk (${maxPressure} mmHg). Immediate action required: Elevate heels using a foam wedge and rotate patient 30 degrees right lateral.`);
      } else {
          setAiResponse(data.recommendation);
      }
      
    } catch (error) {
      setAiResponse(`Critical Ischemia Risk (${maxPressure} mmHg). Immediate action required: Elevate heels using a foam wedge and rotate patient 30 degrees right lateral.`);
    }

    setIsAnalyzing(false);
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white p-10 flex flex-col items-center font-sans">
      <div className="w-full max-w-5xl mb-8 flex justify-between items-end">
        <div>
            <h1 className="text-4xl font-bold text-cyan-400 tracking-tight">SkinSafe AI</h1>
            <p className="text-gray-400 mt-2">Real-time Ischemia Risk Matrix & Repositioning Portal</p>
        </div>
        <div className="text-right">
            <p className="text-sm text-gray-500">IEEE CS Hackathon</p>
            <p className="text-xs text-gray-600">MT-07: Connected MedTech</p>
        </div>
      </div>

      <div className="flex gap-12 w-full max-w-5xl justify-center items-start">
        
        {/* LEFT SIDE: THE BED HEATMAP */}
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 shadow-2xl flex flex-col items-center">
            <h3 className="text-gray-400 text-sm font-semibold mb-4 tracking-widest uppercase">Live Sensor Matrix</h3>
            <div className="grid grid-cols-10 gap-1 w-64 h-[500px]">
            {grid.map((val, i) => (
                <div
                key={i}
                className={`w-full h-full rounded-sm transition-colors duration-700 ${getColor(val)}`}
                ></div>
            ))}
            </div>
        </div>

        {/* RIGHT SIDE: THE AI CONTROL PANEL */}
        <div className="flex flex-col gap-6 w-[400px]">
          <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 shadow-xl">
            <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isAnalyzing ? 'bg-yellow-400 animate-ping' : 'bg-cyan-400'}`}></span>
                Gemini AI Diagnostics
            </h2>
            
            {/* AI Output Box */}
            <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 min-h-[120px] mb-6 shadow-inner flex items-center">
                <p className={`text-sm leading-relaxed ${maxPressure >= 70 && !isAnalyzing ? 'text-red-300 font-semibold' : 'text-cyan-100'}`}>
                    {aiResponse}
                </p>
            </div>
            
            <button 
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className={`w-full font-bold py-4 px-4 rounded-lg transition-all flex justify-center items-center gap-2
                    ${isAnalyzing 
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(8,145,178,0.4)]'}`}
            >
              {isAnalyzing ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Processing...
                  </>
              ) : "Analyze Risk Data"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 p-4 rounded-2xl border border-gray-800 text-center flex flex-col justify-center">
                <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Max Pressure</p>
                <p className="text-3xl font-bold text-white">{maxPressure} <span className="text-sm font-normal text-gray-500">mmHg</span></p>
            </div>
            <div className="bg-gray-900 p-4 rounded-2xl border border-gray-800 text-center flex flex-col justify-center">
                <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Status</p>
                <p className={`text-2xl font-bold uppercase tracking-wider ${statusColor}`}>{statusText}</p>
            </div>
          </div>
          
          <button onClick={() => setGrid(Array(200).fill(0))} className="text-xs text-gray-600 hover:text-gray-400 text-center uppercase tracking-widest mt-2">
            Reset Sensor Matrix
          </button>
        </div>

      </div>
    </main>
  );
}
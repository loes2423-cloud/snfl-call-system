"use client";

import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, query } from 'firebase/firestore';
import { Monitor, AlertCircle, Clock, Utensils, CalendarDays, School } from 'lucide-react';

// 시스템 필수: Firebase 초기화
const firebaseConfig = {
  apiKey: "AIzaSyD5Qwb2IMbTij3kOlRHcQgQckCE0z99A_4",
  authDomain: "snfl-call-system.firebaseapp.com",
  projectId: "snfl-call-system",
  storageBucket: "snfl-call-system.firebasestorage.app",
  messagingSenderId: "771071782065",
  appId: "1:771071782065:web:989a355e996ffa44500690"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "snfl-call-system";

export default function App() {
  const [user, setUser] = useState(null);
  
  // 상태 관리: 초기 설정 및 수신 준비 상태
  const [setupMode, setSetupMode] = useState(true);
  const [config, setConfig] = useState({ grade: '1', classNum: '1' });
  const [isReady, setIsReady] = useState(false);
  
  // 상태 관리: 시간 및 대시보드 데이터
  const [currentTime, setCurrentTime] = useState(new Date());
  const [neisData, setNeisData] = useState({ lunch: '로딩중...', dinner: '로딩중...', timetable: [] });
  const [isNeisError, setIsNeisError] = useState(false);
  
  // 상태 관리: 호출 알림
  const [activeCall, setActiveCall] = useState(null);
  const audioRef = useRef(null);
  const alertTimeoutRef = useRef(null);
  const lastPlayedCallRef = useRef(null);
  
  // 중복 호출 방지를 위한 로드 타임 기록
  const loadTimeRef = useRef(Date.now());

  // 1. Firebase 인증 (접근 권한 획득)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth Error:", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 시계 타이머 및 메모리 최적화 (1시간 주기 새로고침)
  useEffect(() => {
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
    const reloadTimer = setInterval(() => {
      console.log("Memory optimization: Reloading TV App...");
      window.location.reload();
    }, 60 * 60 * 1000); // 1시간
    
    return () => {
      clearInterval(clockTimer);
      clearInterval(reloadTimer);
    };
  }, []);

// 3. 나이스(NEIS) API 데이터 패칭
  const fetchNeisData = async (grade, classNum) => {
    try {
      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      
      const officeCode = 'J10'; 
      const schoolCode = '7530762'; 
      // 선생님의 고유 나이스 API 인증키 추가
      const neisApiKey = '5e97c3556ad84223b6fba69e9a887d24';

      // 급식 API 주소에 KEY 값 적용
      const mealRes = await fetch(`https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=${neisApiKey}&Type=json&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&MLSV_YMD=${dateStr}`);
      const mealData = await mealRes.json();
      
      let lunch = '오늘의 중식 정보가 없습니다.';
      let dinner = '오늘의 석식 정보가 없습니다.';

      if (mealData.mealServiceDietInfo) {
        mealData.mealServiceDietInfo[1].row.forEach(meal => {
          const cleanMenu = meal.DDISH_NM
            .replace(/<br\/>/g, ', ')
            .replace(/\([^)]+\)/g, '') 
            .replace(/[^가-힣a-zA-Z0-9, ]/g, '') 
            .replace(/,\s*,/g, ',') 
            .replace(/^[,\s]+|[,\s]+\$/g, '') 
            .trim();

          if (meal.MMEAL_SC_CODE === '2') lunch = cleanMenu;
          if (meal.MMEAL_SC_CODE === '3') dinner = cleanMenu;
        });
      }

      // 시간표 API 주소에 KEY 값 적용
      const timeRes = await fetch(`https://open.neis.go.kr/hub/hisTimetable?KEY=${neisApiKey}&Type=json&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&ALL_TI_YMD=${dateStr}&GRADE=${grade}&CLASS_NM=${classNum}`);
      const timeData = await timeRes.json();
      
      let parsedTimetable = [];
      if (timeData.hisTimetable) {
         parsedTimetable = timeData.hisTimetable[1].row.map(t => ({
             period: t.PERIO,
             subject: t.ITRT_CNTNT.replace(/\*/g, '') 
         }));
      }

      setNeisData({ lunch, dinner, timetable: parsedTimetable });
      setIsNeisError(false);
    } catch (err) {
      console.error('NEIS API 연동 에러:', err);
      setIsNeisError(true);
      setNeisData({ 
        lunch: '급식 정보를 불러올 수 없습니다.', 
        dinner: '급식 정보를 불러올 수 없습니다.', 
        timetable: [] 
      });
    }
  };

  // 4. 수신 대기 시작 (Autoplay 권한 획득)
  const startListening = () => {
    const au = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    au.load();
    audioRef.current = au;
    
    setSetupMode(false);
    setIsReady(true);
    fetchNeisData(config.grade, config.classNum);
  };

// 5. Firebase 호출 실시간 리스너
useEffect(() => {
if (!isReady || !user) return;

const callsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'school_calls');
const q = query(callsCollection);

const unsubscribe = onSnapshot(q, (snapshot) => {
  const allCalls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  const myCalls = allCalls.filter(call => 
    String(call.grade) === String(config.grade) && 
    String(call.classNum) === String(config.classNum) &&
    call.timestamp > loadTimeRef.current
  );

  if (myCalls.length > 0) {
    const latestCall = myCalls.sort((a, b) => b.timestamp - a.timestamp)[0];
    
    // 핵심 수정: 방금 전에 띄웠던 알림과 '완전히 다른 새로운 알림'일 때만 화면 띄우기!
    if (lastPlayedCallRef.current !== latestCall.timestamp) {
      triggerAlert(latestCall);
    }
  }
}, (error) => console.error("Firebase Listen Error: ", error));

// activeCall을 감지 대상에서 빼서 무한 새로고침을 막았습니다.
return () => unsubscribe();
}, [isReady, user, config]);

const triggerAlert = (callData) => {
setActiveCall(callData);
lastPlayedCallRef.current = callData.timestamp; // "나 이 알림 띄웠어!" 라고 도장 찍기

if (audioRef.current) {
  audioRef.current.currentTime = 0;
  audioRef.current.play().catch(e => console.error("Audio play failed:", e));
}

if (alertTimeoutRef.current) {
  clearTimeout(alertTimeoutRef.current);
}

// 60초 후 화면을 원래대로 되돌림
alertTimeoutRef.current = setTimeout(() => {
  setActiveCall(null);
}, 60000);
};

  // UI 1: 초기 설정 및 대기 화면
  if (setupMode) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 p-12 rounded-3xl shadow-2xl max-w-2xl w-full text-center">
          <Monitor className="w-24 h-24 text-blue-500 mx-auto mb-8" />
          <h2 className="text-4xl font-black text-white mb-4">성남외고 스마트 TV 수신기</h2>
          <p className="text-slate-400 mb-12 text-lg">학년과 반을 선택하고 수신 대기를 시작해주세요.</p>
          
          <div className="flex gap-6 justify-center mb-12">
            <div className="flex flex-col w-40">
              <label className="text-slate-400 text-sm font-bold mb-3 uppercase tracking-widest">학년</label>
              <select 
                value={config.grade} 
                onChange={(e) => setConfig({...config, grade: e.target.value})}
                className="bg-slate-800 text-white text-3xl font-bold px-6 py-5 rounded-2xl outline-none focus:ring-4 ring-blue-500 border border-slate-700 text-center text-center-last"
              >
                {[1,2,3].map(n => <option key={n} value={n}>{n}학년</option>)}
              </select>
            </div>
            <div className="flex flex-col w-40">
              <label className="text-slate-400 text-sm font-bold mb-3 uppercase tracking-widest">반</label>
              <select 
                value={config.classNum} 
                onChange={(e) => setConfig({...config, classNum: e.target.value})}
                className="bg-slate-800 text-white text-3xl font-bold px-6 py-5 rounded-2xl outline-none focus:ring-4 ring-blue-500 border border-slate-700 text-center text-center-last"
              >
                {[...Array(8)].map((_, i) => <option key={i+1} value={i+1}>{i+1}반</option>)}
              </select>
            </div>
          </div>

          <button 
            onClick={startListening}
            className="w-full py-6 bg-blue-600 hover:bg-blue-500 text-white text-3xl font-black rounded-2xl transition-all shadow-lg shadow-blue-500/30 animate-pulse"
          >
            수신 대기 시작
          </button>
          
          <div className="mt-8 flex items-center justify-center gap-2 text-slate-500 text-sm">
            <AlertCircle className="w-4 h-4" />
            주번 학생이 아침에 1회 이 버튼을 눌러야 알림 소리가 정상 작동합니다.
          </div>
        </div>
      </div>
    );
  }

  // UI 2: 호출 발생 시 팝업 화면
  if (activeCall) {
    const timeDisplay = activeCall.displayTime || activeCall.timeMode;
    
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-yellow-400 animate-pulse-fast p-4 md:p-12">
        <div className="bg-black/95 p-10 md:p-20 rounded-[3rem] text-center shadow-2xl w-full max-w-6xl border-[16px] border-yellow-500 flex flex-col gap-8 md:gap-14">
          <AlertCircle className="w-24 h-24 text-yellow-500 mx-auto animate-bounce" />
          
          <h1 className="text-7xl md:text-[130px] font-black text-yellow-400 tracking-tight leading-none break-keep">
            {activeCall.studentName} <span className="text-white text-5xl md:text-[90px]">학생!</span>
          </h1>
          
          <div className="text-4xl md:text-7xl font-bold text-white leading-snug break-keep space-y-8 md:space-y-12 mt-4">
            <p><span className="text-blue-400 border-b-8 border-blue-400 pb-2">{timeDisplay}</span></p>
            <p><span className="text-red-400">{activeCall.office}</span>의</p>
            <p><span className="text-green-400 text-6xl md:text-8xl block mt-8">{activeCall.teacherName} 선생님</span>을 찾아가세요.</p>
          </div>
        </div>
      </div>
    );
  }

  // UI 3: 평시 대기 대시보드 화면
  return (
    <div className="min-h-screen bg-black text-white flex flex-col p-8 overflow-hidden select-none">
      
      <header className="flex justify-between items-end border-b-2 border-slate-800 pb-6 mb-8">
        <div>
          <div className="flex items-center gap-3 text-blue-500 mb-2 font-bold tracking-widest text-xl">
            <School className="w-6 h-6" /> 성남외국어고등학교
          </div>
          <h1 className="text-7xl font-black text-white tracking-tighter">
            {config.grade}학년 {config.classNum}반
          </h1>
        </div>
        <div className="text-right">
          <div className="text-3xl font-medium text-slate-400 mb-2">
            {currentTime.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
          <div className="text-[100px] font-black font-mono tracking-tighter leading-none text-blue-100 drop-shadow-lg flex items-center justify-end">
            <Clock className="w-16 h-16 mr-6 text-blue-500 opacity-50" />
            {currentTime.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-8 h-full">
        <section className="col-span-1 md:col-span-4 bg-slate-900 border border-slate-800 rounded-[2rem] p-8 flex flex-col shadow-2xl">
          <h2 className="text-3xl font-bold flex items-center gap-3 text-green-400 mb-8 pb-4 border-b border-slate-800">
            <CalendarDays className="w-8 h-8" /> 오늘의 시간표
          </h2>
          
          <div className="flex-1 flex flex-col gap-3">
            {isNeisError && <p className="text-red-400">데이터를 불러오지 못했습니다.</p>}
            
            {!isNeisError && neisData.timetable.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-xl font-medium border-2 border-dashed border-slate-800 rounded-2xl">
                오늘 등록된 시간표가 없습니다.
              </div>
            )}

            {!isNeisError && neisData.timetable.map((item, idx) => (
              <div key={idx} className="flex items-center bg-slate-800/50 rounded-2xl px-6 py-5">
                <span className="font-mono font-black text-2xl text-slate-500 w-20">{item.period}교시</span>
                <span className="font-bold text-3xl text-white ml-4">{item.subject}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="col-span-1 md:col-span-8 flex flex-col gap-8">
          <div className="flex-1 bg-slate-900 border border-slate-800 rounded-[2rem] p-10 flex flex-col shadow-2xl">
            <h2 className="text-3xl font-bold flex items-center gap-3 text-orange-400 mb-6 pb-4 border-b border-slate-800">
              <Utensils className="w-8 h-8" /> 오늘의 중식
            </h2>
            <div className="flex-1 flex items-center justify-center">
              <p className="text-5xl font-medium leading-[1.6] break-keep text-slate-200 text-center px-10">
                {neisData.lunch}
              </p>
            </div>
          </div>

          <div className="flex-1 bg-slate-900 border border-slate-800 rounded-[2rem] p-10 flex flex-col shadow-2xl">
            <h2 className="text-3xl font-bold flex items-center gap-3 text-purple-400 mb-6 pb-4 border-b border-slate-800">
              <Utensils className="w-8 h-8" /> 오늘의 석식
            </h2>
            <div className="flex-1 flex items-center justify-center">
              <p className="text-5xl font-medium leading-[1.6] break-keep text-slate-200 text-center px-10">
                {neisData.dinner}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-8 text-slate-600 text-xl flex items-center gap-4">
        <span className="w-4 h-4 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.6)]"></span>
        교무실 호출 수신 대기 중...
      </footer>

      <style>{`
        .animate-pulse-fast {
          animation: pulse-fast 1s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse-fast {
          0%, 100% { opacity: 1; background-color: #eab308; } 
          50% { opacity: .95; background-color: #fef08a; } 
        }
        select.text-center-last {
          text-align-last: center;
        }
      `}</style>
    </div>
  );
}
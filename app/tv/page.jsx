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
  
  const [setupMode, setSetupMode] = useState(true);
  const [config, setConfig] = useState({ grade: '1', classNum: '1' });
  const [isReady, setIsReady] = useState(false);
  
  const [currentTime, setCurrentTime] = useState(new Date());
  const [neisData, setNeisData] = useState({ lunch: '로딩중...', dinner: '로딩중...', timetable: [] });
  const [isNeisError, setIsNeisError] = useState(false);
  
  const [activeCall, setActiveCall] = useState(null);
  const audioRef = useRef(null);
  const alertTimeoutRef = useRef(null);
  const lastPlayedCallRef = useRef(null);
  
  const loadTimeRef = useRef(Date.now());

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

  useEffect(() => {
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
    const reloadTimer = setInterval(() => {
      window.location.reload();
    }, 60 * 60 * 1000);
    
    return () => {
      clearInterval(clockTimer);
      clearInterval(reloadTimer);
    };
  }, []);

  const fetchNeisData = async (grade, classNum) => {
    try {
      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      
      const officeCode = 'J10'; 
      const schoolCode = '7530762'; 
      const neisApiKey = '5e97c3556ad84223b6fba69e9a887d24';

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

  const startListening = () => {
    const au = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    au.load();
    audioRef.current = au;
    
    setSetupMode(false);
    setIsReady(true);
    fetchNeisData(config.grade, config.classNum);
  };

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
        
        if (lastPlayedCallRef.current !== latestCall.timestamp) {
          triggerAlert(latestCall);
        }
      }
    }, (error) => console.error("Firebase Listen Error: ", error));

    return () => unsubscribe();
  }, [isReady, user, config]);

  const triggerAlert = (callData) => {
    setActiveCall(callData);
    lastPlayedCallRef.current = callData.timestamp; 

    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.error("Audio play failed:", e));
    }

    if (alertTimeoutRef.current) {
      clearTimeout(alertTimeoutRef.current);
    }

    alertTimeoutRef.current = setTimeout(() => {
      setActiveCall(null);
    }, 60000);
  };

  // UI 1: 초기 설정 화면 (구형 브라우저 강제 스타일 적용)
  if (setupMode) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', margin: 0 }}>
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', padding: '40px', borderRadius: '24px', textAlign: 'center', width: '100%', maxWidth: '600px' }}>
          <Monitor color="#3b82f6" size={80} style={{ margin: '0 auto 20px auto' }} />
          <h2 style={{ fontSize: '32px', fontWeight: 'bold', color: '#fff', marginBottom: '16px' }}>성남외고 스마트 TV 수신기</h2>
          <p style={{ color: '#94a3b8', fontSize: '18px', marginBottom: '40px' }}>학년과 반을 선택하고 수신 대기를 시작해주세요.</p>
          
          <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', marginBottom: '40px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>학년</label>
              <select 
                value={config.grade} 
                onChange={(e) => setConfig({...config, grade: e.target.value})}
                style={{ backgroundColor: '#1e293b', color: '#fff', fontSize: '24px', fontWeight: 'bold', padding: '16px 20px', borderRadius: '12px', border: '1px solid #334155', textAlign: 'center' }}
              >
                {[1,2,3].map(n => <option key={n} value={n}>{n}학년</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>반</label>
              <select 
                value={config.classNum} 
                onChange={(e) => setConfig({...config, classNum: e.target.value})}
                style={{ backgroundColor: '#1e293b', color: '#fff', fontSize: '24px', fontWeight: 'bold', padding: '16px 20px', borderRadius: '12px', border: '1px solid #334155', textAlign: 'center' }}
              >
                {[...Array(8)].map((_, i) => <option key={i+1} value={i+1}>{i+1}반</option>)}
              </select>
            </div>
          </div>

          <button 
            onClick={startListening}
            style={{ width: '100%', padding: '24px', backgroundColor: '#2563eb', color: '#fff', fontSize: '28px', fontWeight: 'bold', borderRadius: '16px', border: 'none', cursor: 'pointer' }}
          >
            수신 대기 시작
          </button>
        </div>
      </div>
    );
  }

  // UI 2: 호출 팝업 (구형 브라우저 강제 스타일 적용)
  if (activeCall) {
    const timeDisplay = activeCall.displayTime || activeCall.timeMode;
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, backgroundColor: '#facc15', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ backgroundColor: '#000', padding: '60px', borderRadius: '40px', textAlign: 'center', border: '16px solid #eab308', width: '100%', maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '40px' }}>
          <AlertCircle color="#eab308" size={100} style={{ margin: '0 auto' }} />
          
          <h1 style={{ fontSize: '100px', fontWeight: 'bold', color: '#facc15', margin: 0, lineHeight: '1.2' }}>
            {activeCall.studentName} <span style={{ color: '#fff', fontSize: '70px' }}>학생!</span>
          </h1>
          
          <div style={{ fontSize: '50px', fontWeight: 'bold', color: '#fff', lineHeight: '1.6', marginTop: '20px' }}>
            <p style={{ margin: '0 0 20px 0' }}><span style={{ color: '#60a5fa', borderBottom: '6px solid #60a5fa', paddingBottom: '10px' }}>{timeDisplay}</span></p>
            <p style={{ margin: '0 0 20px 0' }}><span style={{ color: '#f87171' }}>{activeCall.office}</span>의</p>
            <p style={{ margin: 0 }}><span style={{ color: '#4ade80', fontSize: '70px' }}>{activeCall.teacherName} 선생님</span>을 찾아가세요.</p>
          </div>
        </div>
      </div>
    );
  }

  // UI 3: 대시보드 (최신 Grid 대신 구형도 지원하는 Flex 레이아웃으로 변경)
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#000', color: '#fff', display: 'flex', flexDirection: 'column', padding: '40px', boxSizing: 'border-box', margin: 0 }}>
      
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #1e293b', paddingBottom: '20px', marginBottom: '30px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#3b82f6', marginBottom: '8px', fontWeight: 'bold', fontSize: '24px' }}>
            <School size={28} /> 성남외국어고등학교
          </div>
          <h1 style={{ fontSize: '70px', fontWeight: 'bold', margin: 0 }}>
            {config.grade}학년 {config.classNum}반
          </h1>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '24px', color: '#94a3b8', marginBottom: '10px' }}>
            {currentTime.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
          <div style={{ fontSize: '80px', fontWeight: 'bold', color: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', margin: 0 }}>
            <Clock size={60} color="#3b82f6" style={{ marginRight: '20px' }} />
            {currentTime.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', gap: '30px' }}>
        {/* 좌측: 시간표 (폭 35%) */}
        <section style={{ width: '35%', backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '32px', padding: '30px', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontSize: '32px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '12px', color: '#4ade80', marginBottom: '24px', borderBottom: '1px solid #1e293b', paddingBottom: '16px', marginTop: 0 }}>
            <CalendarDays size={32} /> 오늘의 시간표
          </h2>
          
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {isNeisError && <p style={{ color: '#f87171' }}>데이터를 불러오지 못했습니다.</p>}
            {!isNeisError && neisData.timetable.length === 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '20px', border: '2px dashed #1e293b', borderRadius: '16px' }}>
                오늘 등록된 시간표가 없습니다.
              </div>
            )}
            {!isNeisError && neisData.timetable.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: '16px', padding: '20px 24px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '24px', color: '#64748b', width: '80px' }}>{item.period}교시</span>
                <span style={{ fontWeight: 'bold', fontSize: '28px', color: '#fff', marginLeft: '16px' }}>{item.subject}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 우측: 급식 (폭 65%) */}
        <section style={{ width: '65%', display: 'flex', flexDirection: 'column', gap: '30px' }}>
          <div style={{ flex: 1, backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '32px', padding: '40px', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '32px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '12px', color: '#fb923c', marginBottom: '20px', borderBottom: '1px solid #1e293b', paddingBottom: '16px', marginTop: 0 }}>
              <Utensils size={32} /> 오늘의 중식
            </h2>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: '42px', fontWeight: '500', color: '#e2e8f0', textAlign: 'center', lineHeight: '1.6', margin: 0 }}>
                {neisData.lunch}
              </p>
            </div>
          </div>

          <div style={{ flex: 1, backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '32px', padding: '40px', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '32px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '12px', color: '#c084fc', marginBottom: '20px', borderBottom: '1px solid #1e293b', paddingBottom: '16px', marginTop: 0 }}>
              <Utensils size={32} /> 오늘의 석식
            </h2>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: '42px', fontWeight: '500', color: '#e2e8f0', textAlign: 'center', lineHeight: '1.6', margin: 0 }}>
                {neisData.dinner}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer style={{ marginTop: '30px', color: '#475569', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ width: '16px', height: '16px', backgroundColor: '#22c55e', borderRadius: '50%' }}></span>
        교무실 호출 수신 대기 중...
      </footer>
    </div>
  );
}
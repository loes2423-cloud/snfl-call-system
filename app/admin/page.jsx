"use client";

import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc } from 'firebase/firestore';
import { Send, Clock, User, Mic, School, Bell, CheckCircle2, Lock, Mail, ChevronRight, MapPin, CalendarDays } from 'lucide-react';

// Firebase 설정 및 초기화 (시스템 필수 규칙 적용)
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

export default function AdminApp() {
  // 시스템 인증 상태
  const [firebaseUser, setFirebaseUser] = useState(null);
  
  // 앱 내 로그인 플로우 상태: 'email' -> 'pin' -> 'authenticated'
  const [authStep, setAuthStep] = useState('email');
  const [emailInput, setEmailInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [authError, setAuthError] = useState('');

  // 폼 입력 상태
  const [formData, setFormData] = useState({
    grade: '1',
    classNum: '1',
    timeMode: '즉시',
    periodTime: '', 
    customTime: '',
    studentName: '',
    office: '2층 1교무실',
    teacherName: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // 교사용 페이지 실시간 시간표 상태
  const [adminTimetable, setAdminTimetable] = useState([]);
  const [isTimetableLoading, setIsTimetableLoading] = useState(false);

  // Firebase 백그라운드 인증
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

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setFirebaseUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // 학년/반이 바뀔 때마다 나이스 API에서 해당 학급 시간표 실시간 조회
  useEffect(() => {
    if (authStep !== 'authenticated') return;

    const fetchAdminTimetable = async () => {
      setIsTimetableLoading(true);
      try {
        const today = new Date();
        const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        
        const officeCode = 'J10'; 
        const schoolCode = '7530762'; // 성남외고 학교 코드
        const neisApiKey = '5e97c3556ad84223b6fba69e9a887d24'; // 나이스 API 키

        const timeRes = await fetch(`https://open.neis.go.kr/hub/hisTimetable?KEY=${neisApiKey}&Type=json&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&ALL_TI_YMD=${dateStr}&GRADE=${formData.grade}&CLASS_NM=${formData.classNum}`);
        const timeData = await timeRes.json();
        
        let parsedTimetable = [];
        if (timeData.hisTimetable) {
           parsedTimetable = timeData.hisTimetable[1].row.map(t => ({
               period: t.PERIO,
               subject: t.ITRT_CNTNT.replace(/\*/g, '') 
           }));
        }
        setAdminTimetable(parsedTimetable);
      } catch (err) {
        console.error('Admin Timetable Error:', err);
        setAdminTimetable([]);
      } finally {
        setIsTimetableLoading(false);
      }
    };

    fetchAdminTimetable();
  }, [formData.grade, formData.classNum, authStep]);

  // 1단계: 이메일 검증
  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (emailInput.trim().endsWith('@snfl.hs.kr')) {
      setAuthStep('pin');
      setAuthError('');
    } else {
      setAuthError('성남외국어고등학교 계정(@snfl.hs.kr)만 접근 가능합니다.');
    }
  };

  // 2단계: PIN 번호 검증
  const handlePinSubmit = (e) => {
    e.preventDefault();
    if (pinInput === 'snfl') {
      setAuthStep('authenticated');
      setAuthError('');
    } else {
      setAuthError('PIN 번호가 일치하지 않습니다.');
    }
  };

  // 호출 데이터 전송
  const handleCallSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.studentName.trim() || !formData.teacherName.trim()) {
      setAuthError('학생 이름과 호출 교사명을 모두 입력해주세요.');
      return;
    }
    if (formData.timeMode === '기타' && !formData.customTime.trim()) {
      setAuthError('기타 호출 시간을 입력해주세요.');
      return;
    }
    if (formData.timeMode === 'O교시 종료 후' && !formData.periodTime.trim()) {
      setAuthError('몇 교시 종료 후인지 숫자를 입력해주세요.');
      return;
    }
    if (formData.timeMode === 'O교시 종료 후' && (parseInt(formData.periodTime) < 1 || parseInt(formData.periodTime) > 8)) {
      setAuthError('교시는 1에서 8 사이의 숫자만 입력 가능합니다.');
      return;
    }

    if (!firebaseUser) {
      setAuthError('서버 연결 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    setIsSubmitting(true);
    setAuthError('');
    
    try {
      const callsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'school_calls');
      
      let finalTime = formData.timeMode;
      if (formData.timeMode === 'O교시 종료 후') finalTime = `${formData.periodTime}교시 종료 후`;
      if (formData.timeMode === '기타') finalTime = formData.customTime;

      const payload = {
        grade: formData.grade,
        classNum: formData.classNum,
        timeMode: formData.timeMode, 
        displayTime: finalTime, 
        studentName: formData.studentName,
        office: formData.office,
        teacherName: formData.teacherName,
        timestamp: Date.now(),
        senderId: firebaseUser.uid,
        status: 'active'
      };

      await addDoc(callsCollection, payload);
      
      setSuccessMessage(`${formData.grade}학년 ${formData.classNum}반 ${formData.studentName} 학생 호출이 전송되었습니다.`);
      setFormData(prev => ({ ...prev, studentName: '', customTime: '', periodTime: '', timeMode: '즉시' }));
      
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (error) {
      console.error("Error adding document: ", error);
      setAuthError('전송 중 오류가 발생했습니다. 네트워크 상태를 확인해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // 로그인 화면
  if (authStep !== 'authenticated') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="bg-indigo-600 p-8 text-center text-white">
            <School className="w-16 h-16 mx-auto mb-4 text-indigo-100" />
            <h1 className="text-2xl font-bold mb-2">성남외고 학생 호출 시스템</h1>
            <p className="text-indigo-200 text-sm">교직원 전용 관리자 페이지</p>
          </div>
          
          <div className="p-8">
            {authStep === 'email' ? (
              <form onSubmit={handleEmailSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">학교 구글 워크스페이스 계정</label>
                  <div className="relative">
                    <input 
                      type="email" 
                      placeholder="teacher@snfl.hs.kr" 
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      required
                    />
                    <Mail className="absolute left-4 top-3.5 text-slate-400 w-5 h-5" />
                  </div>
                </div>
                {authError && <p className="text-red-500 text-sm font-medium">{authError}</p>}
                <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2">
                  다음으로 <ChevronRight className="w-5 h-5" />
                </button>
              </form>
            ) : (
              <form onSubmit={handlePinSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">PIN 번호 입력</label>
                  <div className="relative">
                    <input 
                      type="password" 
                      placeholder="시스템 PIN 입력" 
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition-all tracking-widest"
                      required
                      autoFocus
                    />
                    <Lock className="absolute left-4 top-3.5 text-slate-400 w-5 h-5" />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">안전한 사용을 위해 PIN 번호를 입력해주세요.</p>
                </div>
                {authError && <p className="text-red-500 text-sm font-medium">{authError}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setAuthStep('email')} className="px-4 py-3 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium">
                    이전
                  </button>
                  <button type="submit" className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-colors">
                    로그인
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 인증 완료 후 관리자 메인 화면 (2단 그리드: 좌측은 호출 폼, 우측은 실시간 학급 시간표)
  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
              <Send className="text-indigo-600" />
              성남외고 학생 호출 송신 & 학급 현황
            </h1>
            <p className="text-slate-500 mt-2">교실 TV 알림 전송 및 학급별 실시간 시간표 확인 ({emailInput})</p>
          </div>
          <button 
            onClick={() => { setAuthStep('email'); setEmailInput(''); setPinInput(''); }} 
            className="px-4 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 text-slate-600 font-medium"
          >
            로그아웃
          </button>
        </header>

        {successMessage && (
          <div className="mb-6 p-5 bg-green-50 border border-green-200 rounded-xl shadow-sm flex items-center gap-3">
            <CheckCircle2 className="text-green-500 w-6 h-6 flex-shrink-0" />
            <p className="text-green-800 font-bold text-lg">{successMessage}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* 좌측: 학생 호출 폼 (7칸) */}
          <div className="lg:col-span-7 bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden p-6 md:p-8">
            <form onSubmit={handleCallSubmit} className="space-y-8">
              
              {/* 섹션 1: 대상 학생 */}
              <div>
                <h3 className="text-lg font-bold text-slate-800 border-b pb-2 mb-4 flex items-center gap-2">
                  <User className="w-5 h-5 text-indigo-500" /> 수신 대상
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">학년</label>
                    <select name="grade" value={formData.grade} onChange={handleInputChange} className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 font-bold">
                      <option value="1">1학년</option>
                      <option value="2">2학년</option>
                      <option value="3">3학년</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">학급</label>
                    <select name="classNum" value={formData.classNum} onChange={handleInputChange} className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 font-bold">
                      {[...Array(8)].map((_, i) => (
                        <option key={i+1} value={i+1}>{i+1}반</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">학생 이름</label>
                    <input 
                      type="text" 
                      name="studentName"
                      placeholder="예: 홍길동"
                      value={formData.studentName}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50"
                    />
                  </div>
                </div>
              </div>

              {/* 섹션 2: 호출 시간 */}
              <div>
                <h3 className="text-lg font-bold text-slate-800 border-b pb-2 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-500" /> 호출 시간
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  {['즉시', 'O교시 종료 후', '기타'].map((mode) => (
                    <label key={mode} className={`text-center py-3 px-2 rounded-xl cursor-pointer border-2 transition-all ${formData.timeMode === mode ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-bold shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                      <input type="radio" name="timeMode" value={mode} checked={formData.timeMode === mode} onChange={handleInputChange} className="hidden" />
                      {mode}
                    </label>
                  ))}
                </div>
                
                {formData.timeMode === 'O교시 종료 후' && (
                  <div className="mb-4 flex items-center gap-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                    <input 
                      type="number" 
                      name="periodTime"
                      placeholder="예: 3"
                      min="1"
                      max="8"
                      value={formData.periodTime}
                      onChange={handleInputChange}
                      className="w-24 px-4 py-2 rounded-lg border-2 border-indigo-200 focus:ring-2 focus:ring-indigo-500 outline-none text-center font-bold text-lg bg-white"
                    />
                    <span className="text-lg font-bold text-indigo-800">교시 종료 후</span>
                  </div>
                )}

                {formData.timeMode === '기타' && (
                  <div className="mb-4">
                    <input 
                      type="text" 
                      name="customTime"
                      placeholder="예: 점심시간 종치면 바로"
                      value={formData.customTime}
                      onChange={handleInputChange}
                      className="w-full pl-4 pr-4 py-3 rounded-xl border-2 border-indigo-200 focus:ring-2 focus:ring-indigo-500 outline-none bg-indigo-50/30 font-medium"
                    />
                  </div>
                )}
              </div>

              {/* 섹션 3: 발신자 정보 */}
              <div>
                <h3 className="text-lg font-bold text-slate-800 border-b pb-2 mb-4 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-indigo-500" /> 호출 위치 및 담당자
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">호출 교무실</label>
                    <select name="office" value={formData.office} onChange={handleInputChange} className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50">
                      <option value="2층 1교무실">2층 1교무실</option>
                      <option value="2층 2교무실">2층 2교무실</option>
                      <option value="3층 3교무실">3층 3교무실</option>
                      <option value="1학년 교무실">1학년 교무실</option>
                      <option value="2학년 교무실">2학년 교무실</option>
                      <option value="3학년 교무실">3학년 교무실</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">담당 교사명</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        name="teacherName"
                        placeholder="예: 김선생"
                        value={formData.teacherName}
                        onChange={handleInputChange}
                        className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50"
                      />
                      <Mic className="absolute left-4 top-3.5 text-slate-400 w-5 h-5" />
                    </div>
                  </div>
                </div>
              </div>

              {authError && <p className="text-red-500 text-sm font-bold text-center">{authError}</p>}

              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white font-black text-xl py-5 rounded-2xl hover:bg-indigo-700 transition-colors disabled:bg-indigo-400 disabled:cursor-not-allowed shadow-xl shadow-indigo-200"
              >
                {isSubmitting ? '전송 중...' : '교실 TV로 호출 알림 보내기'}
                <Bell className="w-6 h-6" />
              </button>
            </form>
          </div>

          {/* 우측: 선택한 학급의 실시간 시간표 확인 패널 (5칸) */}
          <div className="lg:col-span-5 bg-slate-900 text-white rounded-2xl shadow-xl border border-slate-800 p-6 md:p-8 flex flex-col">
            <h3 className="text-2xl font-bold flex items-center gap-3 text-green-400 mb-2 pb-4 border-b border-slate-800">
              <CalendarDays className="w-7 h-7" /> {formData.grade}학년 {formData.classNum}반 시간표
            </h3>
            <p className="text-slate-400 text-sm mb-6">현재 학생들이 교실에 있는지 수업 과목을 확인하세요.</p>

            <div className="flex-1 flex flex-col gap-3 overflow-y-auto max-h-[500px]">
              {isTimetableLoading && (
                <div className="flex-1 flex items-center justify-center text-slate-400 py-20">
                  시간표 불러오는 중...
                </div>
              )}

              {!isTimetableLoading && adminTimetable.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-base font-medium border-2 border-dashed border-slate-800 rounded-2xl py-20 text-center px-4">
                  오늘 등록된 시간표가 없거나<br />주말/공휴일입니다.
                </div>
              )}

              {!isTimetableLoading && adminTimetable.map((item, idx) => (
                <div key={idx} className="flex items-center bg-slate-800/80 rounded-xl px-5 py-4 border border-slate-700/50">
                  <span className="font-mono font-bold text-xl text-indigo-400 w-24">{item.period}교시</span>
                  <span className="font-bold text-2xl text-white ml-2">{item.subject}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-500 text-center">
              * 좌측 상단에서 학년과 반을 변경하면 실시간으로 연동됩니다.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
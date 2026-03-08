import React, { useState, useEffect, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  getDocs,
  updateDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { db, auth, loginWithGoogle, logout } from './firebase';
import { 
  Sale, 
  Expense, 
  ExpenseCategory, 
  ExpenseType, 
  DailySummary, 
  AIAnalysis,
  CommissionRule
} from './types';
import { 
  IVA_RATE, 
  EXPENSE_CATEGORIES, 
  DEFAULT_PROFESSIONALS, 
  DEFAULT_COMMISSION_RULES,
  DEFAULT_SERVICE_PRICES
} from './constants';
import { analyzeDailyPerformance, parseReceipt } from './services/geminiService';
import { 
  TrendingUp, 
  DollarSign, 
  Users, 
  Calendar, 
  PieChart as PieChartIcon,
  AlertTriangle,
  CheckCircle,
  Lightbulb,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Plus,
  Trash2,
  Camera,
  Upload,
  FileText,
  User as UserIcon,
  Settings as SettingsIcon
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [analyses, setAnalyses] = useState<AIAnalysis[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [commissionRules, setCommissionRules] = useState<Record<string, CommissionRule>>(DEFAULT_COMMISSION_RULES);
  const [servicePrices, setServicePrices] = useState<Record<string, any>>(DEFAULT_SERVICE_PRICES);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const showSuccess = (message: string) => setNotification({ message, type: 'success' });
  const showError = (message: string) => setNotification({ message, type: 'error' });

  useEffect(() => {
    if (!user) return;
    const settingsQuery = query(collection(db, 'settings'), where('userId', '==', user.uid));
    const unsubSettings = onSnapshot(settingsQuery, (snapshot) => {
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        setCommissionRules(data.commissionRules || {});
        setServicePrices(data.servicePrices || DEFAULT_SERVICE_PRICES);
      }
    });
    return unsubSettings;
  }, [user]);

  const saveSettings = async (rules: Record<string, CommissionRule>, prices: Record<string, any>) => {
    if (!user) return;
    const settingsQuery = query(collection(db, 'settings'), where('userId', '==', user.uid));
    const snapshot = await getDocs(settingsQuery);
    
    if (snapshot.empty) {
      await addDoc(collection(db, 'settings'), {
        userId: user.uid,
        commissionRules: rules,
        servicePrices: prices,
        updatedAt: new Date().toISOString()
      });
    } else {
      const docRef = doc(db, 'settings', snapshot.docs[0].id);
      await updateDoc(docRef, {
        commissionRules: rules,
        servicePrices: prices,
        updatedAt: new Date().toISOString()
      });
    }
  };

  // Form states
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [prefilledProfessional, setPrefilledProfessional] = useState<string | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    const salesQuery = query(collection(db, 'sales'), where('userId', '==', user.uid), orderBy('date', 'desc'));
    const expensesQuery = query(collection(db, 'expenses'), where('userId', '==', user.uid), orderBy('date', 'desc'));
    const analysesQuery = query(collection(db, 'analyses'), where('userId', '==', user.uid), orderBy('date', 'desc'));

    const unsubSales = onSnapshot(salesQuery, (snapshot) => {
      setSales(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale)));
    });

    const unsubExpenses = onSnapshot(expensesQuery, (snapshot) => {
      setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense)));
    });

    const unsubAnalyses = onSnapshot(analysesQuery, (snapshot) => {
      setAnalyses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AIAnalysis)));
    });

    return () => {
      unsubSales();
      unsubExpenses();
      unsubAnalyses();
    };
  }, [user]);

  const dailySummary = useMemo(() => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const daySales = sales.filter(s => s.date.startsWith(dateStr));
    
    const totalSales = daySales.reduce((sum, s) => sum + s.totalAmount, 0);
    const netSales = daySales.reduce((sum, s) => sum + s.netAmount, 0);
    const iva = daySales.reduce((sum, s) => sum + s.ivaAmount, 0);
    const totalCost = daySales.reduce((sum, s) => sum + (s.costAmount || 0), 0);
    const commissionsPaid = daySales.reduce((sum, s) => sum + s.commissionAmount, 0);

    // Group sales by professional
    const salesByProfessional = daySales.reduce((acc, sale) => {
      if (!acc[sale.professionalName]) {
        acc[sale.professionalName] = [];
      }
      acc[sale.professionalName].push(sale);
      return acc;
    }, {} as Record<string, Sale[]>);

    // Ensure default professionals are present
    DEFAULT_PROFESSIONALS.forEach(prof => {
      if (!salesByProfessional[prof]) {
        salesByProfessional[prof] = [];
      }
    });

    // Calculate daily expenses
    const directExpenses = expenses
      .filter(e => e.date.startsWith(dateStr) && e.type === ExpenseType.VARIABLE)
      .reduce((sum, e) => sum + e.amount, 0);

    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    const daysInMonth = monthEnd.getDate();
    
    const monthFixedExpenses = expenses
      .filter(e => {
        const eDate = parseISO(e.date);
        return e.type === ExpenseType.FIXED && 
               eDate >= monthStart && 
               eDate <= monthEnd;
      })
      .reduce((sum, e) => sum + e.amount, 0);
    
    const proratedFixed = monthFixedExpenses / daysInMonth;
    const dailyExpenses = directExpenses + proratedFixed;

    const profit = netSales - commissionsPaid - dailyExpenses - totalCost;

    return {
      date: dateStr,
      netSales,
      iva,
      totalSales,
      totalCost,
      commissionsPaid,
      dailyExpenses,
      profit,
      salesByProfessional
    };
  }, [sales, expenses, selectedDate]);

  const currentAnalysis = useMemo(() => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    return analyses.find(a => a.date === dateStr);
  }, [analyses, selectedDate]);

  const handleGenerateAnalysis = async () => {
    if (!user) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeDailyPerformance(dailySummary);
      await addDoc(collection(db, 'analyses'), {
        ...result,
        date: dailySummary.date,
        userId: user.uid
      });
    } catch (error) {
      console.error("Error generating analysis:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#5A5A40]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-[32px] p-12 shadow-xl text-center">
          <div className="w-20 h-20 bg-[#5A5A40] rounded-full flex items-center justify-center mx-auto mb-8">
            <TrendingUp className="text-white w-10 h-10" />
          </div>
          <h1 className="font-serif text-4xl mb-4 text-[#1a1a1a]">SalonAnalyst Pro</h1>
          <p className="text-[#5A5A40]/70 mb-12 font-serif italic">Tu consultor financiero inteligente para el salón.</p>
          <button 
            onClick={loginWithGoogle}
            className="w-full bg-[#5A5A40] text-white rounded-full py-4 font-medium hover:bg-[#4A4A30] transition-colors flex items-center justify-center gap-3"
          >
            <Users className="w-5 h-5" />
            Ingresar con Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#1a1a1a] font-sans pb-20">
      {/* Header */}
      <header className="bg-white border-b border-[#5A5A40]/10 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center">
              <TrendingUp className="text-white w-6 h-6" />
            </div>
            <span className="font-serif text-2xl font-medium">SalonAnalyst</span>
          </div>
          
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-[#F5F5F0] rounded-full transition-colors text-[#5A5A40]"
              title="Configuración de Comisiones"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-medium">{user.displayName}</span>
              <span className="text-xs text-[#5A5A40]/60 italic">Propietario</span>
            </div>
            <button 
              onClick={logout}
              className="p-2 hover:bg-[#F5F5F0] rounded-full transition-colors text-[#5A5A40]"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-8">
        {/* Date Selector */}
        <div className="flex items-center justify-between mb-8 bg-white p-4 rounded-3xl shadow-sm border border-[#5A5A40]/5">
          <button 
            onClick={() => setSelectedDate(prev => new Date(prev.setDate(prev.getDate() - 1)))}
            className="p-2 hover:bg-[#F5F5F0] rounded-full transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-[#5A5A40]" />
            <span className="font-serif text-xl capitalize">
              {format(selectedDate, "EEEE, d 'de' MMMM", { locale: es })}
            </span>
          </div>
          <button 
            onClick={() => setSelectedDate(prev => new Date(prev.setDate(prev.getDate() + 1)))}
            className="p-2 hover:bg-[#F5F5F0] rounded-full transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Summary & Actions */}
          <div className="space-y-8">
            {/* Quick Stats */}
            <div className="bg-white rounded-[32px] p-8 shadow-sm border border-[#5A5A40]/5">
              <h2 className="font-serif text-xl mb-6 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-[#5A5A40]" />
                Resumen del Día
              </h2>
              <div className="space-y-4">
                <StatRow label="Venta Total" value={dailySummary.totalSales} />
                <StatRow label="Venta Neta" value={dailySummary.netSales} />
                <StatRow label="IVA (19%)" value={dailySummary.iva} />
                <div className="h-px bg-[#5A5A40]/10 my-2" />
                <StatRow label="Costo Productos" value={dailySummary.totalCost} isNegative />
                <StatRow label="Comisiones" value={dailySummary.commissionsPaid} isNegative />
                <StatRow label="Gastos Diarios" value={dailySummary.dailyExpenses} isNegative />
                <div className="h-px bg-[#5A5A40]/10 my-2" />
                <div className="flex justify-between items-center pt-2">
                  <span className="font-serif text-lg">Utilidad</span>
                  <span className={`text-2xl font-bold ${dailySummary.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    ${Math.round(dailySummary.profit).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => setShowSaleForm(true)}
                className="bg-[#5A5A40] text-white p-6 rounded-[24px] flex flex-col items-center gap-3 hover:bg-[#4A4A30] transition-all shadow-md active:scale-95"
              >
                <Plus className="w-6 h-6" />
                <span className="font-medium">Nueva Venta</span>
              </button>
              <button 
                onClick={() => setShowExpenseForm(true)}
                className="bg-white text-[#5A5A40] border border-[#5A5A40]/20 p-6 rounded-[24px] flex flex-col items-center gap-3 hover:bg-[#F5F5F0] transition-all shadow-sm active:scale-95"
              >
                <Plus className="w-6 h-6" />
                <span className="font-medium">Nuevo Gasto</span>
              </button>
            </div>
          </div>

          {/* Middle Column: AI Analysis */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-[#5A5A40] text-white rounded-[32px] p-8 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32" />
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="font-serif text-2xl flex items-center gap-3">
                    <Lightbulb className="w-7 h-7 text-yellow-400" />
                    Análisis del Analista IA
                  </h2>
                  {!currentAnalysis && (
                    <button 
                      onClick={handleGenerateAnalysis}
                      disabled={isAnalyzing || dailySummary.totalSales === 0}
                      className="bg-white text-[#5A5A40] px-6 py-2 rounded-full text-sm font-bold hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generar Análisis'}
                    </button>
                  )}
                </div>

                {currentAnalysis ? (
                  <div className="space-y-6">
                    <p className="font-serif italic text-white/90 text-lg leading-relaxed">
                      "{currentAnalysis.summary}"
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <AnalysisSection 
                        title="Aspectos Positivos" 
                        items={currentAnalysis.positives} 
                        icon={<CheckCircle className="w-4 h-4 text-emerald-400" />} 
                      />
                      <AnalysisSection 
                        title="Alertas" 
                        items={currentAnalysis.alerts} 
                        icon={<AlertTriangle className="w-4 h-4 text-rose-400" />} 
                      />
                    </div>

                    <div className="bg-white/10 p-6 rounded-2xl">
                      <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Consejos de Optimización
                      </h3>
                      <ul className="space-y-2">
                        {currentAnalysis.tips.map((tip, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <span className="text-yellow-400 mt-1">•</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <PieChartIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-white/60 font-serif italic">
                      {dailySummary.totalSales > 0 
                        ? "Haz clic en 'Generar Análisis' para obtener insights de hoy."
                        : "Registra ventas para obtener un análisis financiero."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Sales Table - Replaced by Blocks */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-2xl flex items-center gap-2">
                  <Users className="w-6 h-6 text-[#5A5A40]" />
                  Ventas por Instalador
                </h2>
                <button 
                  onClick={() => {
                    setPrefilledProfessional(undefined);
                    setShowSaleForm(true);
                  }}
                  className="text-sm font-bold text-[#5A5A40] hover:underline flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Nuevo Profesional
                </button>
              </div>

              {Object.keys(dailySummary.salesByProfessional).length === 0 ? (
                <div className="bg-white rounded-[32px] p-12 text-center border border-[#5A5A40]/5 shadow-sm">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-10" />
                  <p className="text-[#5A5A40]/50 italic font-serif">No hay ventas registradas para hoy.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(Object.entries(dailySummary.salesByProfessional) as [string, Sale[]][]).map(([prof, profSales]) => (
                    <div key={prof} className="bg-white rounded-[32px] p-6 shadow-sm border border-[#5A5A40]/5 flex flex-col">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-[#F5F5F0] rounded-full flex items-center justify-center">
                            <UserIcon className="w-5 h-5 text-[#5A5A40]" />
                          </div>
                          <div>
                            <h3 className="font-bold text-lg">{prof}</h3>
                            <p className="text-xs text-[#5A5A40]/60">{profSales.length} boletas</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-[#5A5A40]/50 font-bold">Ventas</p>
                            <p className="font-bold text-[#5A5A40]">${profSales.reduce((sum, s) => sum + s.totalAmount, 0).toLocaleString()}</p>
                          </div>
                          <div className="bg-[#5A5A40]/5 px-3 py-1 rounded-lg">
                            <p className="text-[10px] uppercase tracking-wider text-[#5A5A40]/50 font-bold">Comisión</p>
                            <p className="font-bold text-emerald-600">${Math.round(profSales.reduce((sum, s) => sum + s.commissionAmount, 0)).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 space-y-2 mb-6">
                        {profSales.map(sale => (
                          <div key={sale.id} className="group flex items-center justify-between p-3 bg-[#F5F5F0]/50 rounded-2xl hover:bg-[#F5F5F0] transition-colors">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {sale.serviceName}
                                {sale.quantity > 1 && <span className="ml-2 text-[10px] bg-[#5A5A40]/10 px-1.5 py-0.5 rounded text-[#5A5A40]">x{sale.quantity}</span>}
                              </p>
                              <p className="text-[10px] text-[#5A5A40]/60 truncate">
                                {sale.clientName ? `Cliente: ${sale.clientName}` : 'Sin cliente'}
                              </p>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-sm font-bold">${sale.totalAmount.toLocaleString()}</p>
                                <p className="text-[10px] font-medium text-emerald-600">Com: ${Math.round(sale.commissionAmount).toLocaleString()}</p>
                              </div>
                              <button 
                                onClick={() => deleteDoc(doc(db, 'sales', sale.id))}
                                className="p-1 text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-50 rounded-full"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button 
                        onClick={() => {
                          setPrefilledProfessional(prof);
                          setShowSaleForm(true);
                        }}
                        className="w-full py-3 rounded-2xl border border-dashed border-[#5A5A40]/30 text-[#5A5A40] text-sm font-bold hover:bg-[#F5F5F0] transition-colors flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Subir Boleta
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      {showSaleForm && (
        <SaleForm 
          onClose={() => setShowSaleForm(false)} 
          userId={user.uid} 
          selectedDate={selectedDate}
          prefilledProfessional={prefilledProfessional}
          commissionRules={commissionRules}
          servicePrices={servicePrices}
          onNotify={showSuccess}
        />
      )}
      {showExpenseForm && (
        <ExpenseForm 
          onClose={() => setShowExpenseForm(false)} 
          userId={user.uid} 
          selectedDate={selectedDate}
          onNotify={showSuccess}
        />
      )}
      {showSettings && (
        <SettingsModal 
          onClose={() => setShowSettings(false)}
          commissionRules={commissionRules}
          servicePrices={servicePrices}
          onSave={(rules, prices) => saveSettings(rules, prices)}
          onNotify={showSuccess}
        />
      )}

      {/* Notifications */}
      {notification && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className={`px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 ${
            notification.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
          }`}>
            {notification.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <span className="font-medium">{notification.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsModal({ onClose, commissionRules, servicePrices, onSave, onNotify }: { onClose: () => void, commissionRules: Record<string, CommissionRule>, servicePrices: Record<string, any>, onSave: (rules: Record<string, CommissionRule>, prices: Record<string, any>) => void, onNotify: (msg: string) => void }) {
  const [activeTab, setActiveTab] = useState<'commissions' | 'prices'>('commissions');
  const [rules, setRules] = useState<Record<string, CommissionRule>>(commissionRules);
  const [prices, setPrices] = useState<Record<string, any>>(servicePrices);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleSave = () => {
    onSave(rules, prices);
    onNotify("Configuración guardada correctamente");
    onClose();
  };

  const updateRule = (key: string, field: keyof CommissionRule, value: any) => {
    setRules(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }));
  };

  const removeRule = (key: string) => {
    const newRules = { ...rules };
    delete newRules[key];
    setRules(newRules);
  };

  const addRule = () => {
    const name = prompt("Nombre del servicio para la regla:");
    if (name && !rules[name]) {
      setRules(prev => ({
        ...prev,
        [name]: { type: 'percentage', value: 50 }
      }));
    }
  };

  const updatePrice = (key: string, field: string, value: any) => {
    setPrices(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }));
  };

  const removePrice = (key: string) => {
    const newPrices = { ...prices };
    delete newPrices[key];
    setPrices(newPrices);
  };

  const addPrice = () => {
    const name = prompt("Nombre del nuevo servicio:");
    if (name && !prices[name]) {
      setPrices(prev => ({
        ...prev,
        [name]: { price: 0, cost: 0, category: 'OTROS', type: 'Servicio' }
      }));
    }
  };

  const downloadTemplate = () => {
    let content = '';
    let filename = '';
    
    if (activeTab === 'commissions') {
      content = "Nombre del Servicio,Tipo (percentage/fixed),Valor\n";
      Object.entries(rules).forEach(([name, rule]) => {
        const r = rule as CommissionRule;
        content += `"${name}",${r.type},${r.value}\n`;
      });
      filename = 'plantilla_comisiones.csv';
    } else {
      content = "Nombre del Servicio,Precio,Costo,Categoría,Tipo\n";
      Object.entries(prices).forEach(([name, data]) => {
        const d = data as any;
        content += `"${name}",${d.price},${d.cost || 0},"${d.category}","${d.type}"\n`;
      });
      filename = 'plantilla_precios.csv';
    }

    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const model = "gemini-3-flash-preview";
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        
        const prompt = activeTab === 'commissions' 
          ? `
            Analiza este documento (Excel/PDF/Imagen) que contiene una lista de servicios y sus comisiones.
            Extrae la información y conviértela en un objeto JSON con el siguiente formato:
            {
              "Nombre del Servicio": { "type": "percentage", "value": 50 },
              "Nombre del Producto": { "type": "fixed", "value": 500 }
            }
            Usa "percentage" para porcentajes y "fixed" para montos fijos.
            Responde SOLO el JSON.
          `
          : `
            Analiza este documento (Excel/PDF/Imagen) que contiene una lista de servicios, sus precios y sus costos.
            Extrae la información y conviértela en un objeto JSON con el siguiente formato:
            {
              "Nombre del Servicio": { "price": 13990, "cost": 1500, "category": "LAVADOS", "type": "Secado" }
            }
            Si no hay costo especificado, usa 0.
            Responde SOLO el JSON.
          `;

        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64.split(',')[1] || base64
                }
              }
            ]
          }
        });

        const parsed = JSON.parse(response.text.trim());
        if (activeTab === 'commissions') {
          setRules(parsed);
        } else {
          setPrices(parsed);
        }
        onNotify("Archivo procesado con éxito");
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error processing file:", error);
      alert("Error al procesar el archivo");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] p-8 w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl">Configuración</h2>
          <div className="flex gap-2">
            <button 
              onClick={downloadTemplate}
              className="flex items-center gap-2 text-xs font-bold bg-[#F5F5F0] px-4 py-2 rounded-full hover:bg-[#E4E4D0] transition-colors"
            >
              <FileText className="w-3 h-3" />
              Plantilla
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="flex items-center gap-2 text-xs font-bold bg-[#F5F5F0] px-4 py-2 rounded-full hover:bg-[#E4E4D0] transition-colors"
            >
              {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              Importar
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
          </div>
        </div>

        <div className="flex border-b border-[#5A5A40]/10 mb-6">
          <button 
            onClick={() => setActiveTab('commissions')}
            className={`px-6 py-2 font-medium text-sm transition-colors relative ${activeTab === 'commissions' ? 'text-[#5A5A40]' : 'text-[#5A5A40]/40'}`}
          >
            Comisiones
            {activeTab === 'commissions' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#5A5A40]" />}
          </button>
          <button 
            onClick={() => setActiveTab('prices')}
            className={`px-6 py-2 font-medium text-sm transition-colors relative ${activeTab === 'prices' ? 'text-[#5A5A40]' : 'text-[#5A5A40]/40'}`}
          >
            Precios y Costos
            {activeTab === 'prices' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#5A5A40]" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto mb-6 pr-2">
          {activeTab === 'commissions' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-[#5A5A40]/70 font-serif italic">
                  Configura si la comisión es un % de la venta neta o un monto fijo ($) por unidad.
                </p>
                <button onClick={addRule} className="text-xs font-bold text-[#5A5A40] flex items-center gap-1 bg-[#F5F5F0] px-3 py-1.5 rounded-full hover:bg-[#E4E4D0]">
                  <Plus className="w-3 h-3" /> Añadir Regla
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(rules).map(([name, rule]) => {
                  const r = rule as CommissionRule;
                  return (
                    <div key={name} className="flex items-center gap-3 p-3 bg-[#F5F5F0]/50 rounded-2xl group">
                      <span className="flex-1 text-sm font-medium truncate">{name}</span>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number"
                          className="w-20 bg-white border-none rounded-lg p-2 text-sm text-right focus:ring-1 focus:ring-[#5A5A40]"
                          value={r.value}
                          onChange={e => updateRule(name, 'value', parseFloat(e.target.value))}
                        />
                        <button 
                          onClick={() => updateRule(name, 'type', r.type === 'percentage' ? 'fixed' : 'percentage')}
                          className={`w-10 h-9 rounded-lg text-xs font-bold transition-colors ${r.type === 'percentage' ? 'bg-[#5A5A40] text-white' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10'}`}
                        >
                          {r.type === 'percentage' ? '%' : '$'}
                        </button>
                        <button onClick={() => removeRule(name)} className="p-2 text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-[#5A5A40]/70 font-serif italic">
                  Gestiona los precios de venta y costos de insumos para cada servicio.
                </p>
                <button onClick={addPrice} className="text-xs font-bold text-[#5A5A40] flex items-center gap-1 bg-[#F5F5F0] px-3 py-1.5 rounded-full hover:bg-[#E4E4D0]">
                  <Plus className="w-3 h-3" /> Añadir Servicio
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(prices).map(([name, data]) => {
                  const d = data as any;
                  return (
                    <div key={name} className="flex items-center gap-4 p-3 bg-[#F5F5F0]/50 rounded-2xl group">
                      <span className="flex-1 text-sm font-medium truncate">{name}</span>
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                          <label className="text-[9px] font-bold text-[#5A5A40]/40 uppercase">Precio</label>
                          <input 
                            type="number"
                            className="w-24 bg-white border-none rounded-lg p-2 text-sm text-right focus:ring-1 focus:ring-[#5A5A40]"
                            value={d.price}
                            onChange={e => updatePrice(name, 'price', parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-[9px] font-bold text-[#5A5A40]/40 uppercase">Costo</label>
                          <input 
                            type="number"
                            className="w-24 bg-white border-none rounded-lg p-2 text-sm text-right focus:ring-1 focus:ring-[#5A5A40]"
                            value={d.cost || 0}
                            onChange={e => updatePrice(name, 'cost', parseFloat(e.target.value))}
                          />
                        </div>
                        <button onClick={() => removePrice(name)} className="p-2 text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity mt-4">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4 border-t border-[#5A5A40]/10">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-[#5A5A40]/20 font-medium">Cancelar</button>
          <button onClick={handleSave} className="flex-1 py-3 rounded-xl bg-[#5A5A40] text-white font-medium">Guardar Cambios</button>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, isNegative = false }: { label: string, value: number, isNegative?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-[#5A5A40]/70">{label}</span>
      <span className={`font-medium ${isNegative ? 'text-rose-500' : ''}`}>
        {isNegative ? '-' : ''}${Math.round(value).toLocaleString()}
      </span>
    </div>
  );
}

function AnalysisSection({ title, items, icon }: { title: string, items: string[], icon: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-white/70">
        {icon}
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-white/90 leading-snug">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SaleForm({ onClose, userId, selectedDate, prefilledProfessional, commissionRules, servicePrices, onNotify }: { onClose: () => void, userId: string, selectedDate: Date, prefilledProfessional?: string, commissionRules: Record<string, CommissionRule>, servicePrices: Record<string, any>, onNotify: (msg: string) => void }) {
  const [clientName, setClientName] = useState('');
  const [professionalName, setProfessionalName] = useState(prefilledProfessional || '');
  const [items, setItems] = useState([{
    serviceName: '',
    totalAmount: '',
    costAmount: '0',
    quantity: '1',
    commissionValue: '50',
    commissionType: 'percentage' as 'percentage' | 'fixed'
  }]);
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const addItem = () => {
    setItems([...items, {
      serviceName: '',
      totalAmount: '',
      costAmount: '0',
      quantity: '1',
      commissionValue: '50',
      commissionType: 'percentage'
    }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    if (field === 'serviceName') {
      const service = value.toLowerCase();
      // Try exact match first, then partial
      let commMatch = Object.entries(commissionRules).find(([key]) => service === key.toLowerCase());
      if (!commMatch) {
        commMatch = Object.entries(commissionRules).find(([key]) => service.includes(key.toLowerCase()));
      }

      if (commMatch) {
        newItems[index].commissionValue = commMatch[1].value.toString();
        newItems[index].commissionType = commMatch[1].type;
        // Add a temporary flag to show visual feedback
        (newItems[index] as any).isAutoMatched = true;
      } else {
        (newItems[index] as any).isAutoMatched = false;
      }

      let priceMatch = Object.entries(servicePrices).find(([key]) => service === key.toLowerCase());
      if (!priceMatch) {
        priceMatch = Object.entries(servicePrices).find(([key]) => service.includes(key.toLowerCase()));
      }

      if (priceMatch && priceMatch[1].price > 0) {
        newItems[index].totalAmount = priceMatch[1].price.toString();
        newItems[index].costAmount = (priceMatch[1].cost || 0).toString();
      }
    }
    setItems(newItems);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const result = await parseReceipt(base64, file.type, prefilledProfessional);
        
        if (result.clientName) setClientName(result.clientName);
        if (!prefilledProfessional && result.professionalName) setProfessionalName(result.professionalName);
        
        if (result.items && result.items.length > 0) {
          const newItems = result.items.map((item: any) => {
            const service = item.serviceName.toLowerCase();
            let commVal = '50';
            let commType: 'percentage' | 'fixed' = 'percentage';
            let cost = '0';

            const commMatch = Object.entries(commissionRules).find(([key]) => service.includes(key.toLowerCase()));
            if (commMatch) {
              commVal = commMatch[1].value.toString();
              commType = commMatch[1].type;
            }

            const priceMatch = Object.entries(servicePrices).find(([key]) => service.includes(key.toLowerCase()));
            if (priceMatch) {
              cost = (priceMatch[1].cost || 0).toString();
            }

            return {
              serviceName: item.serviceName,
              totalAmount: item.totalAmount.toString(),
              costAmount: cost,
              quantity: (item.quantity || 1).toString(),
              commissionValue: commVal,
              commissionType: commType
            };
          });
          setItems(newItems);
        }
        onNotify("Boleta procesada correctamente");
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error scanning receipt:", error);
      alert("Error al procesar la boleta");
    } finally {
      setIsScanning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const savePromises = items.map(async (item) => {
      const total = parseFloat(item.totalAmount);
      const cost = parseFloat(item.costAmount || '0');
      const quantity = parseFloat(item.quantity || '1');
      const commVal = parseFloat(item.commissionValue);
      const net = total / (1 + IVA_RATE);
      const iva = total - net;
      
      let commAmount = 0;
      if (item.commissionType === 'percentage') {
        commAmount = net * (commVal / 100);
      } else {
        commAmount = commVal * quantity;
      }

      return addDoc(collection(db, 'sales'), {
        serviceName: item.serviceName,
        professionalName: professionalName,
        clientName: clientName,
        totalAmount: total,
        costAmount: cost,
        quantity: quantity,
        commissionType: item.commissionType,
        commissionPercentage: commVal,
        commissionAmount: commAmount,
        netAmount: net,
        ivaAmount: iva,
        date: format(selectedDate, "yyyy-MM-dd'T'HH:mm:ss"),
        userId
      });
    });

    await Promise.all(savePromises);
    onNotify("Venta guardada con éxito");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] p-8 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6 sticky top-0 bg-white z-10 pb-4 border-b border-[#5A5A40]/10">
          <div>
            <h2 className="font-serif text-2xl">Registrar Venta</h2>
            {professionalName && (
              <p className="text-sm text-[#5A5A40] font-medium flex items-center gap-1 mt-1">
                <UserIcon className="w-3 h-3" />
                Para: <span className="font-bold">{professionalName}</span>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button 
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isScanning}
              className="flex items-center gap-2 text-xs font-bold bg-[#F5F5F0] px-4 py-2 rounded-full hover:bg-[#E4E4D0] transition-colors disabled:opacity-50"
            >
              {isScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              Escanear Boleta
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept="image/*,application/pdf" 
              className="hidden" 
            />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!prefilledProfessional && (
              <div>
                <label className="block text-xs font-bold uppercase text-[#5A5A40]/50 mb-1">Profesional</label>
                <input 
                  required
                  className="w-full bg-[#F5F5F0] border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40]"
                  value={professionalName}
                  onChange={e => setProfessionalName(e.target.value)}
                  placeholder="Nombre del estilista"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-bold uppercase text-[#5A5A40]/50 mb-1">Cliente (Opcional)</label>
              <input 
                className="w-full bg-[#F5F5F0] border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40]"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="Nombre del cliente"
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#5A5A40]/50">Servicios / Productos</h3>
              <button 
                type="button" 
                onClick={addItem}
                className="text-xs font-bold text-[#5A5A40] flex items-center gap-1 hover:underline"
              >
                <Plus className="w-3 h-3" />
                Agregar otro
              </button>
            </div>

            {items.map((item, index) => (
              <div key={index} className="p-4 bg-[#F5F5F0]/30 rounded-2xl border border-[#5A5A40]/5 relative group">
                {items.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeItem(index)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-[#5A5A40]/40 mb-1">Servicio / Producto</label>
                    <input 
                      required
                      className="w-full bg-white border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40] text-sm"
                      value={item.serviceName}
                      onChange={e => updateItem(index, 'serviceName', e.target.value)}
                      placeholder="Ej: Corte de Cabello"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-[#5A5A40]/40 mb-1">Monto ($)</label>
                      <input 
                        required
                        type="number"
                        className="w-full bg-white border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40] text-sm"
                        value={item.totalAmount}
                        onChange={e => updateItem(index, 'totalAmount', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-[#5A5A40]/40 mb-1">Cant / Lám</label>
                      <input 
                        required
                        type="number"
                        className="w-full bg-white border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40] text-sm"
                        value={item.quantity}
                        onChange={e => updateItem(index, 'quantity', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-[#5A5A40]/40 mb-1">Costo ($)</label>
                      <input 
                        type="number"
                        className="w-full bg-white border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40] text-sm"
                        value={item.costAmount}
                        onChange={e => updateItem(index, 'costAmount', e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[10px] font-bold uppercase text-[#5A5A40]/40">
                        Comisión {item.commissionType === 'percentage' ? '(%)' : '($)'}
                      </label>
                      {(item as any).isAutoMatched && (
                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <CheckCircle className="w-2 h-2" />
                          Regla aplicada
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input 
                        required
                        type="number"
                        className="flex-1 bg-white border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40] text-sm"
                        value={item.commissionValue}
                        onChange={e => {
                          updateItem(index, 'commissionValue', e.target.value);
                          (items[index] as any).isAutoMatched = false; // User manually changed it
                        }}
                      />
                      <button 
                        type="button"
                        onClick={() => {
                          updateItem(index, 'commissionType', item.commissionType === 'percentage' ? 'fixed' : 'percentage');
                          (items[index] as any).isAutoMatched = false;
                        }}
                        className="bg-white px-3 rounded-xl hover:bg-[#E4E4D0] transition-colors text-xs font-bold border border-[#5A5A40]/10"
                      >
                        {item.commissionType === 'percentage' ? '%' : '$'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-6 border-t border-[#5A5A40]/10 sticky bottom-0 bg-white">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-[#5A5A40]/20 font-medium">Cancelar</button>
            <button type="submit" className="flex-1 py-3 rounded-xl bg-[#5A5A40] text-white font-medium">Guardar Venta</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExpenseForm({ onClose, userId, selectedDate, onNotify }: { onClose: () => void, userId: string, selectedDate: Date, onNotify: (msg: string) => void }) {
  const [formData, setFormData] = useState({
    category: ExpenseCategory.OPERACION,
    type: ExpenseType.VARIABLE,
    amount: '',
    description: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDoc(collection(db, 'expenses'), {
      ...formData,
      amount: parseFloat(formData.amount),
      date: format(selectedDate, "yyyy-MM-dd'T'HH:mm:ss"),
      userId
    });
    onNotify("Gasto guardado con éxito");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] p-8 w-full max-w-md shadow-2xl">
        <h2 className="font-serif text-2xl mb-6">Registrar Gasto</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-[#5A5A40]/50 mb-1">Categoría</label>
            <select 
              className="w-full bg-[#F5F5F0] border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40] capitalize"
              value={formData.category}
              onChange={e => setFormData({...formData, category: e.target.value as ExpenseCategory})}
            >
              {EXPENSE_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-[#5A5A40]/50 mb-1">Tipo de Gasto</label>
            <div className="grid grid-cols-2 gap-2">
              <button 
                type="button"
                onClick={() => setFormData({...formData, type: ExpenseType.FIXED})}
                className={`py-2 rounded-xl text-sm font-medium border transition-all ${formData.type === ExpenseType.FIXED ? 'bg-[#5A5A40] text-white border-[#5A5A40]' : 'bg-white text-[#5A5A40] border-[#5A5A40]/20'}`}
              >
                Fijo (Mensual)
              </button>
              <button 
                type="button"
                onClick={() => setFormData({...formData, type: ExpenseType.VARIABLE})}
                className={`py-2 rounded-xl text-sm font-medium border transition-all ${formData.type === ExpenseType.VARIABLE ? 'bg-[#5A5A40] text-white border-[#5A5A40]' : 'bg-white text-[#5A5A40] border-[#5A5A40]/20'}`}
              >
                Variable (Día)
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-[#5A5A40]/50 mb-1">Monto ($)</label>
            <input 
              required
              type="number"
              className="w-full bg-[#F5F5F0] border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40]"
              value={formData.amount}
              onChange={e => setFormData({...formData, amount: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-[#5A5A40]/50 mb-1">Descripción</label>
            <input 
              required
              className="w-full bg-[#F5F5F0] border-none rounded-xl p-3 focus:ring-2 focus:ring-[#5A5A40]"
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
              placeholder="Ej: Pago de luz, Insumos tinte"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-[#5A5A40]/20 font-medium">Cancelar</button>
            <button type="submit" className="flex-1 py-3 rounded-xl bg-[#5A5A40] text-white font-medium">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

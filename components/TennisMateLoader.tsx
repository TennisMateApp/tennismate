'use client';
import { motion } from 'framer-motion';

export default function AppLoader() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0B132B] text-white">
      <motion.div
        animate={{
          rotate: 360,
        }}
        transition={{
          repeat: Infinity,
          duration: 1.2,
          ease: 'linear',
        }}
        className="w-16 h-16 mb-4 rounded-full border-8 border-[#7ED957] border-t-white"
      />
      <p className="text-lg font-semibold tracking-wide">Loading TennisMate...</p>
    </div>
  );
}

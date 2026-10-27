'use client';
import {useEffect} from 'react';
export function Language({lang}:{lang:'tr'|'en'}){useEffect(()=>{document.documentElement.lang=lang;},[lang]);return <a href="#main" className="skip-link">{lang==='en'?'Skip to content':'İçeriğe atla'}</a>;}

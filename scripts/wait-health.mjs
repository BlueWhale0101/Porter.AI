const expected=process.argv[2];
for(let attempt=0;attempt<20;attempt++){
  try{const response=await fetch('http://127.0.0.1:8790/health',{signal:AbortSignal.timeout(1000)});const data=await response.json();if(response.ok&&data.ok&&data.revision===expected)process.exit(0);}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
}
throw new Error('Porter health did not report the expected revision');

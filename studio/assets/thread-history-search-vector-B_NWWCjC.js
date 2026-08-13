var e=32768,t=t=>{let n=t?`${t}.`:``;return`to_tsvector(
		'simple'::regconfig,
		left(coalesce(${n}content, ''), ${e}) || ' ' ||
		left(coalesce(${n}parts::text, ''), ${e})
	)`};export{t};
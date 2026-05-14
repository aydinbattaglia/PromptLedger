const btn = document.getElementById('back-to-top') as HTMLButtonElement;

window.addEventListener('scroll', () => {
  btn.classList.toggle('visible', window.scrollY > 300);
});

btn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import Avatar from './Avatar';

export default function PersonPicker({ people, selected, onChange, ownProfile, required }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const options = [
    ...(!required ? [{ ...ownProfile, id: '', nome: 'Meu próprio gasto', foto_path: ownProfile?.logo_path }] : []),
    ...people,
  ];
  const person = options.find(option => String(option.id) === selected);

  return (
    <div className="person-picker" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <button type="button" className="person-picker__value" ref={trigger}
        aria-label={`Pessoa responsável: ${person?.nome || 'Selecione uma pessoa'}`}
        aria-expanded={open} onClick={() => setOpen(!open)}>
        {person && <Avatar nome={person.nome} foto={person.foto_path} cor={person.cor} />}
        <span>{person?.nome || 'Selecione uma pessoa'}</span>
        <ChevronDown size={16} />
      </button>
      <select
        aria-label="Pessoa responsável"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        value={selected}
        onChange={event => onChange(event.target.value)}
        required={required}
        onInvalid={event => {
          event.preventDefault();
          trigger.current?.focus();
          setOpen(true);
        }}
      >
        {required && <option value="">Selecione uma pessoa</option>}
        {options.map(option => <option key={option.id} value={option.id}>{option.nome}</option>)}
      </select>
      {open && (
        <div className="person-picker__options" aria-label="Escolher pela foto">
          {options.length === 0 && <p className="p-2 text-sm">Nenhuma pessoa cadastrada.</p>}
          {options.map(option => (
            <button
              type="button"
              key={option.id}
              aria-pressed={selected === String(option.id)}
              onClick={() => {
                onChange(String(option.id));
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <Avatar nome={option.nome} foto={option.foto_path} cor={option.cor} />
              <span>{option.nome}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

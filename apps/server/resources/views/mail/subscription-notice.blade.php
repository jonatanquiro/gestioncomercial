Hola {!! $name !!}:

@if ($stage === 'paused')
El acceso de {!! $tradeName !!} a Gestión Comercial quedó pausado porque la suscripción venció el {{ $dueDate }} y no registramos el pago.

Tus datos están guardados. Apenas pagues, el comercio vuelve a funcionar como siempre.
@elseif ($stage === 'due')
La suscripción de {!! $tradeName !!} venció el {{ $dueDate }}. Podés seguir usando el sistema hasta el {{ $blockDate }}; después se pausa el acceso hasta que se registre el pago.
@else
La suscripción de {!! $tradeName !!} (plan {!! $planName !!}, {!! $monthlyPrice !!} por mes) vence el {{ $dueDate }}.

Para seguir usando el sistema sin interrupciones, renovala antes de esa fecha.
@endif

Podés pagar desde acá:
{!! $link !!}

Si ya pagaste, no hace falta que hagas nada: el sistema se actualiza solo cuando se acredita.

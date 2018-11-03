Airblast provides a simple framework to get cloud function jobs with retries up and
running quickly so you can focus on building your jobs with minimal effort on
interacting with cloud infrastructure.

Airblast handles dealing with pubub, express and datastore and you just handle
processing the data.

The framework allows for building controllers that send jobs to one another for processing
so you can logically breakup your background processing by logical concerns.

See the [samples](/samples) for examples of setting up simple controllers

Example of job chains

```
class JobController extends AirblastController {
  // Will return 400 if someone tries to post an invalid payload
  validate(data) {
    if (!data.about) {
      throw new this.AppError(400, 'validation', 'Data must contain about attribute');
    }
  }
  
  // Send the job to the email and airtable controller for processing
  process(data) {
    this.controllers.email.enqueue(data);
    this.controllers.airtable.enqueue(data);
  }
}

class EmailController extends AirblastController {
  process(data) {
    sendEmail({
      to: 'admin@myco.example',
      subject: 'Job received',
      body: `The job is about ${data.about}`
    });
  }
}

class AirtableController extends AirblastController {
  process(data) {
    airtables.insert(data);
  }
}
```

That's it, once you've written your process function,
you've written cloud functions that are ready to deploy!
See the [sample](/sample) directory for scripts
to deploy them.

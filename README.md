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
  validate({ data }) {
    if (!data.about) {
      throw new this.AppError(400, 'validation', 'Data must contain about attribute');
    }
  }

  // Send the job to the email and airtable controller for processing
  async process({ key }) {
    return Promise.all([
      // Pass the key of this record to the other controllers
      this.controllers.email.enqueue({ key }),
      this.controllers.airtable.enqueue({ key }),      
    ])
  }
}

class EmailController extends AirblastController {
  async process({ data }) {
    // Load the record that was passed in
    const payload = await this.load(data.key);
    sendEmail({
      to: 'admin@myco.example',
      subject: 'Job received',
      body: `The job is about ${data.about}`
    });
  }
}

class AirtableController extends AirblastController {
  async process({ data }) {
    const payload = await this.load(data.key);
    airtables.insert(payload);
  }
}
```

That's it, once you've written your process function,
you've written cloud functions that are ready to deploy!
See the [sample](/sample) directory for scripts
to deploy them.
